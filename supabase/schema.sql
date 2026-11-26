-- =====================================================================
--  Rođendani odeljenja — kompletna šema baze
--  Nalepi ceo fajl u Supabase SQL Editor i klikni "Run".
--  Fajl sme da se pokrene više puta (ne briše podatke).
-- =====================================================================
--
--  Bezbednosni model ukratko:
--   * Na svim tabelama je RLS uključen i NEMA nijedne policy, a pored toga
--     su anon/authenticated ulogama oduzeta sva prava nad tabelama.
--     Direktan pristup tabelama preko API-ja je potpuno zatvoren.
--   * Jedini ulaz su funkcije u šemi "public" (RPC), SECURITY DEFINER,
--     sa search_path = '' (sva imena su puna: public.x, extensions.y).
--   * Admin funkcije su u šemi "private" koju Supabase API ne izlaže,
--     a i EXECUTE dozvola im je oduzeta svima osim vlasniku (postgres).
--   * PIN i lični kodovi se čuvaju kao bcrypt heš.
--     Sesijski tokeni (32 nasumična bajta) se čuvaju kao SHA-256 heš.
--   * Promašaji se beleže i posle limita funkcija odbija nove prijave.
--     Greške se VRAĆAJU kao {ok:false,...} a ne bacaju (RAISE), jer bi
--     RAISE poništio i upis promašaja, pa limit ne bi ništa brojao.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
--  TABELE
-- ---------------------------------------------------------------------

-- Podešavanja (tačno jedan red).
create table if not exists public.settings (
  id             boolean primary key default true check (id),
  class_pin_hash text not null,
  updated_at     timestamptz not null default now()
);

-- Učenici. Godina rođenja se namerno NE čuva (samo dan i mesec).
create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null unique check (char_length(btrim(full_name)) between 2 and 80),
  code_hash   text not null,
  birth_month smallint check (birth_month between 1 and 12),
  birth_day   smallint check (birth_day between 1 and 31),
  party_date  date,
  party_time  time,
  party_place text check (char_length(party_place) <= 100),
  status      text not null default 'okvirno' check (status in ('okvirno', 'potvrdjeno')),
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint birth_both_or_none check ((birth_month is null) = (birth_day is null)),
  constraint time_needs_date    check (party_time is null or party_date is not null)
);

-- Sesije: 'view' (posle PIN-a, 12 h) i 'edit' (posle ličnog koda, 30 min).
create table if not exists public.sessions (
  token_hash text primary key,                       -- sha256(token), hex
  kind       text not null check (kind in ('view', 'edit')),
  student_id uuid references public.students(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint edit_has_student check ((kind = 'edit') = (student_id is not null))
);
create index if not exists sessions_expires_idx on public.sessions (expires_at);

-- Promašeni pokušaji (za ograničenje pogađanja).
create table if not exists public.auth_attempts (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('pin', 'code')),
  client_ip  text not null,
  student_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_kind_time_idx on public.auth_attempts (kind, created_at);

-- RLS uključen, bez ijedne policy => anon ne vidi ni jedan red.
alter table public.settings      enable row level security;
alter table public.students      enable row level security;
alter table public.sessions      enable row level security;
alter table public.auth_attempts enable row level security;

-- Dodatno: oduzmi sva prava nad tabelama (Supabase ih podrazumevano daje).
revoke all on table public.settings, public.students, public.sessions, public.auth_attempts
  from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------
--  POMOĆNE FUNKCIJE (private, nedostupne spolja)
-- ---------------------------------------------------------------------

-- IP adresa klijenta iz zaglavlja koja prosleđuje Supabase.
-- cf-connecting-ip postavlja Cloudflare i klijent ne može da ga podmetne.
create or replace function private.client_ip()
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_headers json;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  return coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(v_headers ->> 'x-real-ip'), ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    'nepoznato'
  );
end;
$$;

create or replace function private.hash_token(p_token text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_token, 'sha256'), 'hex')
$$;

-- 32 kriptografski nasumična bajta, base64url.
create or replace function private.new_token()
returns text
language sql volatile
set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_')
$$;

-- Nasumičan kod bez lako zamenljivih znakova (nema 0/O, 1/I/L).
-- Rejection sampling: bajtovi >= 248 se odbacuju da raspodela bude ravnomerna.
create or replace function private.random_code(p_len int default 8)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 znak
  v_result text := '';
  v_byte   int;
begin
  while char_length(v_result) < p_len loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if v_byte < 248 then
      v_result := v_result || substr(c_alphabet, (v_byte % 31) + 1, 1);
    end if;
  end loop;
  return v_result;
end;
$$;

-- Normalizacija unetog koda: velika slova, bez crtica i razmaka.
create or replace function private.normalize_code(p_code text)
returns text
language sql immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create or replace function private.pretty_code(p_code text)
returns text
language sql immutable
set search_path = ''
as $$
  select substr(p_code, 1, 4) || '-' || substr(p_code, 5)
$$;

-- Da li je dostignut limit promašaja?
--   PIN:  5 sa iste IP adrese u 15 min, ili 100 ukupno u 1 h
--   kod:  5 za istog učenika u 15 min, 10 sa iste IP u 15 min, ili 100 ukupno u 1 h
-- Blokira samo NOVE prijave; postojeće sesije rade normalno.
create or replace function private.is_blocked(p_kind text, p_ip text, p_student uuid)
returns boolean
language sql stable
set search_path = ''
as $$
  select
    (select count(*) from public.auth_attempts a
      where a.kind = p_kind and a.client_ip = p_ip
        and a.created_at > now() - interval '15 minutes')
      >= case p_kind when 'pin' then 5 else 10 end
    or
    (p_student is not null and
     (select count(*) from public.auth_attempts a
       where a.kind = p_kind and a.student_id = p_student
         and a.created_at > now() - interval '15 minutes') >= 5)
    or
    (select count(*) from public.auth_attempts a
      where a.kind = p_kind and a.created_at > now() - interval '1 hour') >= 100
$$;

create or replace function private.view_session_ok(p_token text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
    where s.token_hash = private.hash_token(p_token)
      and s.kind = 'view' and s.expires_at > now()
  )
$$;

create or replace function private.edit_session_student(p_token text)
returns uuid
language sql stable
set search_path = ''
as $$
  select s.student_id from public.sessions s
  where s.token_hash = private.hash_token(p_token)
    and s.kind = 'edit' and s.expires_at > now()
$$;

create or replace function private.student_json(p_id uuid)
returns json
language sql stable
set search_path = ''
as $$
  select json_build_object(
    'id',          s.id,
    'full_name',   s.full_name,
    'birth_month', s.birth_month,
    'birth_day',   s.birth_day,
    'party_date',  s.party_date,
    'party_time',  to_char(s.party_time, 'HH24:MI'),
    'party_place', s.party_place,
    'status',      s.status,
    'note',        s.note,
    'updated_at',  s.updated_at
  )
  from public.students s where s.id = p_id
$$;

-- ---------------------------------------------------------------------
--  JAVNE RPC FUNKCIJE (jedino što anon sme da poziva)
-- ---------------------------------------------------------------------

-- Za keepalive (GitHub Actions). Ne dira nikakve podatke.
create or replace function public.ping()
returns text
language sql stable
set search_path = ''
as $$
  select 'ok'::text
$$;

-- Prijava PIN-om odeljenja -> vraća sesijski token (12 h).
create or replace function public.login(p_pin text)
returns json
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ip    text := private.client_ip();
  v_hash  text;
  v_token text;
begin
  -- usput čišćenje starih zapisa
  delete from public.auth_attempts where created_at < now() - interval '1 day';
  delete from public.sessions where expires_at < now();

  if private.is_blocked('pin', v_ip, null) then
    return json_build_object('ok', false, 'error', 'blokirano');
  end if;

  select class_pin_hash into v_hash from public.settings where id;

  if v_hash is null or p_pin is null or char_length(p_pin) > 100
     or extensions.crypt(p_pin, v_hash) <> v_hash then
    insert into public.auth_attempts (kind, client_ip) values ('pin', v_ip);
    return json_build_object('ok', false, 'error', 'pogresan_pin');
  end if;

  delete from public.auth_attempts where kind = 'pin' and client_ip = v_ip;

  v_token := private.new_token();
  insert into public.sessions (token_hash, kind, expires_at)
  values (private.hash_token(v_token), 'view', now() + interval '12 hours');

  return json_build_object('ok', true, 'token', v_token);
end;
$$;

-- Odjava (briše token; radi za oba tipa sesije).
create or replace function public.logout(p_token text)
returns json
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  delete from public.sessions where token_hash = private.hash_token(p_token);
  return json_build_object('ok', true);
end;
$$;

-- Pregled svih učenika (kalendar i spisak). Nikad ne vraća heševe.
create or replace function public.get_overview(p_token text)
returns json
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.view_session_ok(p_token) then
    return json_build_object('ok', false, 'error', 'sesija_istekla');
  end if;

  return json_build_object(
    'ok', true,
    'students', coalesce((
      select json_agg(private.student_json(s.id) order by s.full_name)
      from public.students s
    ), '[]'::json)
  );
end;
$$;

-- Otvaranje sopstvenog unosa: ime (id) + lični kod -> edit token (30 min).
create or replace function public.start_edit(p_token text, p_student_id uuid, p_code text)
returns json
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_ip    text := private.client_ip();
  v_hash  text;
  v_code  text := private.normalize_code(p_code);
  v_token text;
begin
  if not private.view_session_ok(p_token) then
    return json_build_object('ok', false, 'error', 'sesija_istekla');
  end if;

  if private.is_blocked('code', v_ip, p_student_id) then
    return json_build_object('ok', false, 'error', 'blokirano');
  end if;

  select code_hash into v_hash from public.students where id = p_student_id;

  if v_hash is null or char_length(v_code) <> 8
     or extensions.crypt(v_code, v_hash) <> v_hash then
    insert into public.auth_attempts (kind, client_ip, student_id)
    values ('code', v_ip, p_student_id);
    return json_build_object('ok', false, 'error', 'pogresan_kod');
  end if;

  delete from public.auth_attempts where kind = 'code' and student_id = p_student_id;
  delete from public.sessions
   where kind = 'edit' and student_id = p_student_id and expires_at < now();

  v_token := private.new_token();
  insert into public.sessions (token_hash, kind, student_id, expires_at)
  values (private.hash_token(v_token), 'edit', p_student_id, now() + interval '30 minutes');

  return json_build_object('ok', true, 'edit_token', v_token,
                           'student', private.student_json(p_student_id));
end;
$$;

-- Čuvanje sopstvenog unosa. Student se određuje ISKLJUČIVO iz edit tokena,
-- pa niko ne može da izmeni tuđi unos.
create or replace function public.save_my_entry(
  p_edit_token  text,
  p_birth_month int,
  p_birth_day   int,
  p_party_date  date,
  p_party_time  time,
  p_party_place text,
  p_status      text,
  p_note        text
)
returns json
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_student uuid := private.edit_session_student(p_edit_token);
  v_place   text := nullif(btrim(p_party_place), '');
  v_note    text := nullif(btrim(p_note), '');
  v_dummy   date;
begin
  if v_student is null then
    return json_build_object('ok', false, 'error', 'sesija_istekla');
  end if;

  -- rođendan: ili oba polja ili nijedno, i mora biti pravi datum
  if (p_birth_month is null) <> (p_birth_day is null) then
    return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Izaberi i dan i mesec rođenja.');
  end if;
  if p_birth_month is not null then
    begin
      v_dummy := make_date(2028, p_birth_month, p_birth_day);  -- 2028 je prestupna
    exception when others then
      return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Datum rođenja ne postoji.');
    end;
  end if;

  if p_party_date is not null
     and (p_party_date < current_date - 365 or p_party_date > current_date + 3 * 365) then
    return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Datum proslave nije u razumnom opsegu.');
  end if;
  if p_party_date is null and p_party_time is not null then
    return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Vreme bez datuma proslave nema smisla.');
  end if;
  if coalesce(p_status, '') not in ('okvirno', 'potvrdjeno') then
    return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Nepoznat status.');
  end if;
  if char_length(v_place) > 100 then
    return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Mesto može imati najviše 100 znakova.');
  end if;
  if char_length(v_note) > 200 then
    return json_build_object('ok', false, 'error', 'nevalidno', 'message', 'Napomena može imati najviše 200 znakova.');
  end if;

  update public.students set
    birth_month = p_birth_month,
    birth_day   = p_birth_day,
    party_date  = p_party_date,
    party_time  = p_party_time,
    party_place = v_place,
    status      = p_status,
    note        = v_note,
    updated_at  = now()
  where id = v_student;

  -- produži edit sesiju posle uspešnog čuvanja
  update public.sessions set expires_at = now() + interval '30 minutes'
   where token_hash = private.hash_token(p_edit_token);

  return json_build_object('ok', true, 'student', private.student_json(v_student));
end;
$$;

-- ---------------------------------------------------------------------
--  ADMIN FUNKCIJE (samo iz SQL editora; anon ih ne vidi i ne sme da ih pokrene)
-- ---------------------------------------------------------------------

-- Dodaje učenike i vraća ime + kod. Kod se prikazuje SAMO ovde, jednom.
create or replace function private.add_students(p_names text[])
returns table (ime text, kod text)
language plpgsql volatile
set search_path = ''
as $$
declare
  v_name text;
  v_code text;
begin
  foreach v_name in array p_names loop
    v_name := btrim(regexp_replace(coalesce(v_name, ''), '\s+', ' ', 'g'));
    continue when v_name = '';
    if exists (select 1 from public.students s where lower(s.full_name) = lower(v_name)) then
      raise notice 'Preskačem, već postoji: %', v_name;
      continue;
    end if;
    v_code := private.random_code(8);
    insert into public.students (full_name, code_hash)
    values (v_name, extensions.crypt(v_code, extensions.gen_salt('bf', 10)));
    ime := v_name;
    kod := private.pretty_code(v_code);
    return next;
  end loop;
end;
$$;

-- Novi kod za jednog učenika. Stari kod i njegove edit sesije prestaju da važe.
create or replace function private.reset_code(p_name text)
returns table (ime text, kod text)
language plpgsql volatile
set search_path = ''
as $$
declare
  v_id   uuid;
  v_full text;
  v_code text := private.random_code(8);
begin
  select s.id, s.full_name into v_id, v_full
  from public.students s where lower(s.full_name) = lower(btrim(p_name));
  if v_id is null then
    raise exception 'Nema učenika sa imenom: %', p_name;
  end if;

  update public.students
     set code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 10))
   where id = v_id;
  delete from public.sessions where kind = 'edit' and student_id = v_id;
  delete from public.auth_attempts where kind = 'code' and student_id = v_id;

  ime := v_full;
  kod := private.pretty_code(v_code);
  return next;
end;
$$;

-- Postavlja/menja PIN odeljenja. Bez argumenta generiše nasumičan PIN
-- (tako PIN ne ostaje zapisan u istoriji SQL editora).
-- Svi su posle toga odjavljeni.
create or replace function private.set_pin(p_pin text default null)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_pin text := coalesce(p_pin, private.random_code(8));
begin
  if char_length(v_pin) < 6 then
    raise exception 'PIN mora imati najmanje 6 karaktera.';
  end if;
  if char_length(v_pin) > 100 then
    raise exception 'PIN je predugačak.';
  end if;

  insert into public.settings (id, class_pin_hash, updated_at)
  values (true, extensions.crypt(v_pin, extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update
    set class_pin_hash = excluded.class_pin_hash, updated_at = now();

  delete from public.sessions;          -- svi moraju ponovo da se prijave
  delete from public.auth_attempts where kind = 'pin';

  if p_pin is null then
    return 'Novi PIN odeljenja: ' || v_pin;
  end if;
  return 'PIN je promenjen. Svi su odjavljeni.';
end;
$$;

-- Briše sve zabeležene promašaje (skida sve blokade).
create or replace function private.unlock()
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.auth_attempts;
  get diagnostics v_count = row_count;
  return 'Obrisano promašaja: ' || v_count || '. Blokade su skinute.';
end;
$$;

-- Briše učenika (npr. greška u imenu).
create or replace function private.delete_student(p_name text)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.students where lower(full_name) = lower(btrim(p_name));
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Nema učenika sa imenom: %', p_name;
  end if;
  return 'Obrisan: ' || btrim(p_name);
end;
$$;

-- Ispravka imena.
create or replace function private.rename_student(p_old text, p_new text)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.students
     set full_name = btrim(regexp_replace(p_new, '\s+', ' ', 'g'))
   where lower(full_name) = lower(btrim(p_old));
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Nema učenika sa imenom: %', p_old;
  end if;
  return 'Preimenovano u: ' || btrim(p_new);
end;
$$;

-- ---------------------------------------------------------------------
--  DOZVOLE ZA FUNKCIJE
--  Postgres i Supabase podrazumevano daju EXECUTE svima (PUBLIC/anon).
--  Zato prvo oduzmemo SVE, pa vratimo samo ono što anon sme.
-- ---------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function
  public.ping(),
  public.login(text),
  public.logout(text),
  public.get_overview(text),
  public.start_edit(text, uuid, text),
  public.save_my_entry(text, int, int, date, time, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.ping(),
  public.login(text),
  public.logout(text),
  public.get_overview(text),
  public.start_edit(text, uuid, text),
  public.save_my_entry(text, int, int, date, time, text, text, text)
to anon;

-- Osveži keš šeme u PostgREST-u da odmah vidi nove funkcije.
notify pgrst, 'reload schema';

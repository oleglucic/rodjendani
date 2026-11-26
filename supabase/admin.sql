-- =====================================================================
--  Admin komande. Pokreću se SAMO iz Supabase SQL Editora.
--  Ne pokreći ceo fajl odjednom: označi (selektuj) jednu komandu i
--  klikni "Run" (ili Ctrl+Enter), pa pročitaj rezultat ispod.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) PIN ODELJENJA (prvo ovo!)
-- ---------------------------------------------------------------------

-- Preporuka: neka baza sama izmisli PIN (8 znakova). Tako PIN nigde
-- ne ostaje zapisan, ni u istoriji editora. Rezultat: "Novi PIN odeljenja: ...".
select private.set_pin();

-- Ili zadaj svoj (najmanje 6 karaktera). Posle pokretanja OBRIŠI ovaj red,
-- jer Supabase čuva tekst upita u editoru.
-- select private.set_pin('ovde-tvoj-pin');

-- Promena PIN-a radi na isti način. Svi su posle toga odjavljeni i
-- moraju da unesu novi PIN.


-- ---------------------------------------------------------------------
-- 2) DODAVANJE UČENIKA
-- ---------------------------------------------------------------------

-- Rezultat je tabela "ime | kod". Kodovi se prikazuju SAMO SADA. U bazi
-- postoji samo heš, pa niko (ni ti) ne može kasnije da ih pročita.
-- Prepiši ih ili klikni "Export -> CSV", pa svakome pošalji njegov kod privatno.
-- Ako ime već postoji, preskače se (ne pravi duplikat).
select * from private.add_students(array[
  'Ana Anić',
  'Marko Marković',
  'Jelena Jovanović'
  -- , 'Ime Prezime'
]);


-- ---------------------------------------------------------------------
-- 3) RESET KODA (neko je izgubio kod ili ga je neko drugi video)
-- ---------------------------------------------------------------------

-- Stari kod odmah prestaje da važi. Vraća novi kod.
select * from private.reset_code('Ana Anić');


-- ---------------------------------------------------------------------
-- 4) SKIDANJE BLOKADE (neko se zaključao pogrešnim unosom)
-- ---------------------------------------------------------------------

-- Blokada inače sama prolazi za 15 minuta (globalna za 1 sat).
select private.unlock();


-- ---------------------------------------------------------------------
-- 5) ISPRAVKE
-- ---------------------------------------------------------------------

select private.rename_student('Ana Anic', 'Ana Anić');
select private.delete_student('Ime Prezime');


-- ---------------------------------------------------------------------
-- 6) PREGLED (samo za tebe)
-- ---------------------------------------------------------------------

-- Ko još nije upisao proslavu:
select full_name from public.students where party_date is null order by full_name;

-- Sve ukupno:
select full_name,
       lpad(birth_day::text, 2, '0') || '.' || lpad(birth_month::text, 2, '0') || '.' as rodjendan,
       party_date, to_char(party_time, 'HH24:MI') as vreme, party_place, status, note, updated_at
from public.students
order by party_date nulls last, party_time nulls first, full_name;

-- Trenutni promašaji (da vidiš da li neko pokušava da pogađa):
select kind, client_ip, student_id, count(*), max(created_at) as poslednji
from public.auth_attempts
group by 1, 2, 3
order by poslednji desc;


-- ---------------------------------------------------------------------
-- 7) BEZBEDNOSNA PROVERA (pokreni posle schema.sql)
-- ---------------------------------------------------------------------

-- a) Funkcije koje anon sme da pokrene. Očekivano je TAČNO ovih 6:
--    get_overview, login, logout, ping, save_my_entry, start_edit
--    (+ rls_auto_enable ako je pri pravljenju projekta uključeno "Enable RLS on new
--     tables automatically". To je Supabase-ov event trigger; ne može se pozvati
--     direktno, pa je bezopasan.)
select n.nspname as sema, p.proname as funkcija
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and has_function_privilege('anon', p.oid, 'execute')
order by 1, 2;

-- b) Prava anon-a nad tabelama. Očekivano je sve "false":
select t.tablename,
       has_table_privilege('anon', 'public.' || t.tablename, 'select') as sel,
       has_table_privilege('anon', 'public.' || t.tablename, 'insert') as ins,
       has_table_privilege('anon', 'public.' || t.tablename, 'update') as upd,
       has_table_privilege('anon', 'public.' || t.tablename, 'delete') as del
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in ('settings', 'students', 'sessions', 'auth_attempts');

-- c) RLS uključen na svim tabelama (očekivano je sve "true") i bez policy-ja:
select relname, relrowsecurity from pg_class
where relname in ('settings', 'students', 'sessions', 'auth_attempts') and relkind = 'r';
select * from pg_policies where schemaname = 'public';   -- očekivano: 0 redova

-- d) Kodovi i PIN su heširani (počinju sa $2a$), nigde nema običnog teksta:
select full_name, left(code_hash, 7) || '…' as hes from public.students limit 5;
select left(class_pin_hash, 7) || '…' as pin_hes from public.settings;

# 🎂 Rođendani odeljenja

Mala web aplikacija u kojoj odeljenje na jednom mestu vidi kad ko slavi 18. rođendan, da se proslave ne bi poklopile.

- **Frontend:** obična statična stranica (HTML/CSS/JS, bez build koraka) na GitHub Pages.
- **Backend:** Supabase (Postgres), besplatan plan.
- **Pristup:** PIN odeljenja za gledanje, lični kod za izmenu sopstvenog unosa.

```
rodjendan/
├─ index.html            stranica
├─ style.css             izgled
├─ app.js                logika aplikacije
├─ ics.js                pravljenje .ics fajlova za kalendar
├─ skolski-kalendar.js   raspusti i praznici 2026/27 (iz pravilnika ministarstva)
├─ config.js             Supabase URL i ključ (jedino što menjaš)
├─ fonts/                font (lokalno, bez Google zahteva)
├─ supabase/
│  ├─ schema.sql         cela baza: tabele, RLS, funkcije, dozvole
│  └─ admin.sql          admin komande (učenici, kodovi, PIN, provera)
└─ .github/workflows/
   └─ keepalive.yml      drži Supabase projekat budnim
```

---

## Podešavanje korak po korak

### 1. Napravi Supabase projekat

1. Otvori <https://supabase.com>, napravi nalog i klikni **New project**.
2. Ime je proizvoljno (npr. `rodjendani`). Za **Database password** klikni *Generate* i sačuvaj lozinku negde.
3. Za **Region** izaberi **Central EU (Frankfurt)**, najbliži je.
4. Klikni **Create new project** i sačekaj minut-dva.

### 2. Napravi bazu

1. U levom meniju otvori **SQL Editor** i klikni **New query**.
2. Otvori fajl `supabase/schema.sql`, kopiraj **ceo** sadržaj, nalepi ga i klikni **Run**.
3. Dole treba da piše *Success. No rows returned*.

> Ako Supabase pita nešto tipa *„This query has destructive operations“*, to je zbog `revoke` komandi (oduzimanje prava). Potvrdi.

### 3. Postavi PIN i dodaj učenike

U SQL Editoru otvori novi query i nalepi `supabase/admin.sql`. **Ne pokreći ceo fajl.** Označi jednu komandu mišem i klikni **Run** (ili Ctrl+Enter).

1. **PIN:** pokreni `select private.set_pin();` i zapiši PIN koji dobiješ. Njega šalješ celom odeljenju.
2. **Učenici:** u `add_students(array[...])` upiši sva imena, svako pod navodnicima i odvojeno zarezom, pa pokreni.
3. Dobićeš tabelu **ime | kod**. Klikni **Export → CSV** ili prepiši kodove. **Ovo je jedini trenutak kada se kodovi vide.** U bazi postoji samo njihov heš.
4. Svakome pošalji **samo njegov** kod, privatnom porukom.

### 4. Ubaci ključeve u `config.js`

1. U Supabase-u otvori **Project Settings → API Keys** (ili **Data API**).
2. Kopiraj **Project URL** (`https://xxxx.supabase.co`) u `SUPABASE_URL`.
3. Kopiraj **anon public** ključ (ili **publishable**, `sb_publishable_...`) u `SUPABASE_ANON_KEY`.
4. Po želji promeni `CLASS_NAME`.

> ⚠️ **Nikad** ne stavljaj `service_role` / `secret` ključ. On zaobilazi svu zaštitu. Anon ključ je napravljen da bude javan i bezbedno ga je objaviti, jer zaštitu radi baza, a ne ključ.

### 5. Preporučena podešavanja u Supabase-u

- **Authentication → Sign In / Providers:** isključi **Allow new users to sign up**. Aplikacija ne koristi Supabase naloge, pa nema potrebe da iko može da ga napravi.
- **Project Settings → Data API → Exposed schemas:** treba da bude samo `public` (i `graphql_public`). **Nemoj** dodavati `private`.

### 6. Probaj lokalno (opciono)

Stranica mora da se otvori preko lokalnog servera, ne duplim klikom na fajl. U PowerShell-u, u folderu projekta:

```powershell
python -m http.server 8000
```

Zatim otvori <http://localhost:8000>.

### 7. Objavi na GitHub Pages

1. Na <https://github.com> napravi novi repozitorijum (npr. `rodjendani`). Može i **Public**, jer u kodu nema tajni.
2. Postavi sve fajlove: **Add file → Upload files**, prevuci ceo sadržaj foldera (uključujući `supabase/`, `.github/` i `.nojekyll`) i klikni **Commit**.
   Ako koristiš git:
   ```powershell
   git init
   ```
   ```powershell
   git add .
   ```
   ```powershell
   git commit -m "Rođendani odeljenja"
   ```
   ```powershell
   git branch -M main
   ```
   ```powershell
   git remote add origin https://github.com/TVOJE-IME/rodjendani.git
   ```
   ```powershell
   git push -u origin main
   ```
3. U repozitorijumu otvori **Settings → Pages**. Za **Source** izaberi *Deploy from a branch*, branch **main**, folder **/ (root)**, pa **Save**.
4. Posle minut-dva stranica je na `https://TVOJE-IME.github.io/rodjendani/`. Taj link i PIN pošalji odeljenju.

> Napomena: Upload kroz web interfejs ponekad preskoči foldere koji počinju tačkom (`.github`). Ako se to desi, u repozitorijumu klikni **Add file → Create new file**, upiši ime `.github/workflows/keepalive.yml` i nalepi sadržaj.

### 8. Keepalive (da se baza ne „uspava“)

Supabase besplatni projekat se **pauzira posle 7 dana bez aktivnosti**. Workflow `keepalive.yml` dva puta nedeljno pozove bezopasnu funkciju `ping()`.

1. U repozitorijumu otvori karticu **Actions**. Ako traži, klikni **I understand… enable**.
2. Levo izaberi **Supabase keepalive**, pa **Run workflow**, da proveriš da radi (treba da bude zeleno ✓).
3. GitHub gasi zakazane workflow-e ako u repozitorijumu nema promena 60 dana. Pošalje ti mejl, a ti samo klikneš da ga ponovo uključiš.

Ako se projekat ipak pauzira, u Supabase dashboard-u klikni **Restore project**. Podaci ostaju.

---

## Svakodnevno korišćenje (admin)

Sve se radi iz **SQL Editora**. Komande su u `supabase/admin.sql`:

| Šta | Komanda |
|---|---|
| Novi učenik | `select * from private.add_students(array['Ime Prezime']);` |
| Neko je izgubio kod | `select * from private.reset_code('Ime Prezime');` |
| Promena PIN-a (svi se odjavljuju) | `select private.set_pin();` |
| Neko se zaključao | `select private.unlock();` |
| Pogrešno ime | `select private.rename_student('Staro', 'Novo');` |
| Brisanje učenika | `select private.delete_student('Ime Prezime');` |

---

## Kako je zaštićeno i zašto

**1. Anon ključ je javan, pa frontend ne štiti ništa.** Svako može da otvori JS, uzme ključ i šalje zahteve direktno Supabase-u, mimo naše stranice. Zato su sve provere u bazi, a JS je samo izgled.

**2. Tabele su potpuno zatvorene.** Na svim tabelama je uključen RLS (Row Level Security) bez ijedne policy. To znači da anon ne vidi nijedan red. Pored toga, `REVOKE ALL` oduzima anon-u i samo pravo nad tabelama. Ovo su dva nezavisna sloja: i kad bi jedan bio slučajno pokvaren, drugi drži.

**3. Jedini ulaz su funkcije (RPC).** Anon sme da pokrene tačno 6 funkcija: `ping`, `login`, `logout`, `get_overview`, `start_edit`, `save_my_entry`. One su `SECURITY DEFINER`, što znači da rade sa pravima vlasnika baze, ali **samo ono što je u njima napisano**. Svaka prvo proveri token. `get_overview` nikad ne vraća heševe, a `save_my_entry` menja isključivo red učenika kome pripada edit token. ID učenika se uopšte ne prima od klijenta, pa je izmena tuđeg unosa nemoguća.

**4. `search_path = ''`.** SECURITY DEFINER funkcija sa podesivim search_path-om može da se prevari podmetanjem lažne funkcije ili tabele sa istim imenom. Zato je search_path prazan i sva imena su puna (`public.students`, `extensions.crypt`).

**5. Eksplicitan `REVOKE EXECUTE`.** Postgres, a i Supabase, **podrazumevano daje svima pravo da pokrenu svaku novu funkciju**. Zato šema prvo oduzme sva prava, pa vrati anon-u samo onih 6 funkcija. Admin funkcije su pored toga u šemi `private` koju Supabase API ne izlaže, pa spolja ni ne postoje.

**6. Heširanje.** PIN i kodovi se čuvaju kao **bcrypt** heš (`crypt` + `gen_salt('bf')`). Ni ti ne možeš da ih pročitaš, samo da ih proveriš. bcrypt je namerno spor, što pogađanje čini skupim. Sesijski tokeni su 32 nasumična bajta i čuvaju se kao SHA-256 heš. Za tako dug nasumičan token brz heš je dovoljan, a ukradena baza ne otkriva aktivne tokene.

**7. Tokeni umesto PIN-a.** Posle unosa PIN-a browser dobija token koji važi 12 h i čuva ga u `sessionStorage` (briše se kad zatvoriš tab). Sam PIN se nigde ne čuva. Lični kod se ne čuva ni u `sessionStorage`. Posle provere koda dobija se edit token od 30 minuta koji postoji samo u memoriji stranice. Promena PIN-a briše sve sesije, a reset koda briše edit sesije tog učenika.

**8. Ograničenje pogađanja.** Svaki promašaj se upisuje u tabelu `auth_attempts`:

| | Limit | Blokada |
|---|---|---|
| PIN, ista IP adresa | 5 promašaja / 15 min | ~15 min |
| Kod, isti učenik | 5 promašaja / 15 min | ~15 min |
| Kod, ista IP adresa | 10 promašaja / 15 min | ~15 min |
| Ukupno (bilo ko) | 100 promašaja / 1 h | do 1 h |

Globalni limit je rezerva za slučaj da napadač menja IP adrese. Blokira samo **nove prijave**: ko je već unutra, radi normalno. Važan detalj: funkcije promašaj **vraćaju** kao `{ok:false}`, a ne bacaju grešku (`RAISE`), jer bi greška poništila celu transakciju, pa i upis promašaja, i limit ne bi ništa brojao.

Zašto je ovo dovoljno: kod ima 8 znakova iz azbuke od 31 znaka, što je oko 850 milijardi mogućnosti. Sa 5 pokušaja na 15 minuta po učeniku, pogađanje bi trajalo milionima godina.

**9. Godina rođenja se ne čuva.** Čuvaju se samo dan i mesec. Što ne postoji u bazi, ne može ni da procuri.

**10. Zaštita od ubacivanja koda (XSS).** Imena i napomene unose korisnici, pa ih stranica prikazuje isključivo kao tekst (`textContent`, nikad `innerHTML`). Dodatno, *Content-Security-Policy* dozvoljava skripte samo sa našeg sajta i jsDelivr-a, a Supabase biblioteka je zaključana na tačnu verziju sa SRI hešom. Ako bi CDN poslao izmenjen fajl, browser ga ne bi pokrenuo.

**Šta ova zaštita NE pokriva:** ko zna PIN, vidi spisak, a PIN zna celo odeljenje, pa ga neko može proslediti dalje. Ako procuri, promeni ga (`set_pin()`). Lični kodovi su lični: ko pokaže svoj kod drugome, daje mu pravo da menja njegov unos.

---

## ✅ Ručna provera zaštite

Uradi ovo jednom, posle podešavanja. Najlakše je iz konzole browsera: otvori svoju objavljenu stranicu, pritisni **F12** i otvori karticu **Console**. Biblioteka i podešavanja su već učitani. Prvo nalepi ovo:

```js
const c = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);
```

(Chrome možda traži da prvo otkucaš `allow pasting`.)

| # | Test | Šta nalepiti | Očekivano |
|---|---|---|---|
| 1 | Direktno čitanje tabele | `await c.from('students').select('*')` | `error`, *permission denied for table students* |
| 2 | Čitanje heševa/PIN-a | `await c.from('settings').select('*')` | `error`, *permission denied* |
| 3 | Direktan upis | `await c.from('students').insert({full_name:'Haker', code_hash:'x'})` | `error`, *permission denied* |
| 4 | Direktna izmena | `await c.from('students').update({note:'hakovano'}).neq('full_name','')` | `error`, *permission denied* |
| 5 | Admin funkcija spolja | `await c.rpc('add_students', {p_names:['X']})` | `error`, funkcija ne postoji |
| 6 | Admin šema spolja | `await c.schema('private').rpc('set_pin', {})` | `error`, *Invalid schema: private* |
| 7 | Pregled bez prijave | `await c.rpc('get_overview', {p_token:'izmisljen'})` | `data: {ok:false, error:'sesija_istekla'}` |
| 8 | Izmena bez koda | `await c.rpc('save_my_entry', {p_edit_token:'x', p_birth_month:null, p_birth_day:null, p_party_date:null, p_party_time:null, p_party_place:null, p_status:'okvirno', p_note:'hak'})` | `data: {ok:false, error:'sesija_istekla'}` |
| 9 | Limit za PIN | 6 puta: `(await c.rpc('login', {p_pin:'pogresan1'})).data` | 5× `pogresan_pin`, pa `blokirano`. Posle toga čak i **tačan** PIN vraća `blokirano`. Na kraju pokreni `select private.unlock();` |
| 10 | Limit za kod | U aplikaciji 6 puta unesi pogrešan kod za jedno ime | 6. put: „Previše pogrešnih pokušaja“. Pa `unlock()`. |
| 11 | Promena PIN-a odjavljuje | Prijavi se, pokreni `select private.set_pin();`, pa u aplikaciji klikni ↻ | Vraća te na ekran za PIN |
| 12 | XSS | U „Moj unos“ upiši napomenu `<img src=x onerror=alert(1)>` i sačuvaj | Prikazuje se kao običan tekst, nema prozorčića |

Isto se može i iz PowerShell-a, bez browsera (zameni URL i ključ):

```powershell
curl.exe -s "https://TVOJ-PROJEKAT.supabase.co/rest/v1/students?select=*" -H "apikey: TVOJ-ANON-KLJUC"
```

Očekivano: JSON sa `"code":"42501"` i *permission denied for table students*.

I na kraju u **SQL Editoru** pokreni odeljak **7) BEZBEDNOSNA PROVERA** iz `admin.sql`:

- **a)** anon sme da pokrene **tačno** 6 funkcija: `get_overview`, `login`, `logout`, `ping`, `save_my_entry`, `start_edit`;
- **b)** sve kolone `false`;
- **c)** RLS `true` na sve 4 tabele i **0** policy-ja;
- **d)** heševi počinju sa `$2a$`, nigde nema običnog teksta.

> Supabase **Security Advisor** (Database → Advisors) prijaviće *„RLS Enabled No Policy“* za naše tabele. To je **namerno**: bez policy-ja niko ne može direktno da pristupi tabelama. Upozorenje *„Function Search Path Mutable“* **ne bi** trebalo da se pojavi za naše funkcije.

---

## Font

Korišćen je [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) (SIL Open Font License 1.1), hostovan lokalno u folderu `fonts/`, pa stranica ne šalje zahteve Google-u.

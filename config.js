// =====================================================================
//  PODEŠAVANJA: jedino mesto koje treba da izmeniš.
//  Vrednosti nađeš u Supabase: Project Settings -> API (Data API / API Keys).
//
//  Ovde ide SAMO javni ključ ("anon public" ili "publishable", sb_publishable_...).
//  NIKADA ne stavljaj "service_role" / "secret" ključ: on zaobilazi svu zaštitu!
// =====================================================================

window.APP_CONFIG = Object.freeze({
  SUPABASE_URL: 'https://TVOJ-PROJEKAT.supabase.co',
  SUPABASE_ANON_KEY: 'TVOJ-ANON-KLJUC',

  // Prikazuje se u zaglavlju (može i prazno).
  CLASS_NAME: 'III-1',

  // Trajanje proslave u .ics fajlu kad je uneto vreme (u satima).
  PARTY_HOURS: 4,

  // Godina u kojoj svi pune 18 (u kalendaru piše "puni 18").
  YEAR_18: 2027,
});

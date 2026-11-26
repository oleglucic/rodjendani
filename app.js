// =====================================================================
//  Rođendani odeljenja: logika aplikacije
//
//  Napomena o bezbednosti: ovaj kod NIJE zaštita. Sve provere radi baza.
//  Ovde samo pazimo da se tekst koji unose korisnici prikazuje kao tekst
//  (textContent, nikad innerHTML), da ne bi bilo moguće ubaciti HTML/JS.
// =====================================================================
'use strict';

(() => {
  const cfg = window.APP_CONFIG || {};
  const TOKEN_KEY = 'rodjendani.token';
  const YEAR_18 = Number(cfg.YEAR_18) || 2027;   // godina u kojoj svi pune 18

  // ------------------------------------------------------------------
  //  Srpski nazivi
  // ------------------------------------------------------------------
  const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul',
                  'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
  const MONTHS_GEN = ['januara', 'februara', 'marta', 'aprila', 'maja', 'juna', 'jula',
                      'avgusta', 'septembra', 'oktobra', 'novembra', 'decembra'];
  const DAYS = ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'];
  const STATUS_LABEL = { okvirno: 'okvirno', potvrdjeno: 'potvrđeno' };

  const ERRORS = {
    pogresan_pin: 'Pogrešan PIN.',
    pogresan_kod: 'Pogrešan lični kod.',
    blokirano: 'Previše pogrešnih pokušaja. Sačekaj 15 minuta pa pokušaj ponovo.',
    sesija_istekla: 'Sesija je istekla. Prijavi se ponovo.',
    nevalidno: 'Neispravni podaci.',
  };
  const NETWORK_ERROR = 'Nema veze sa serverom. Proveri internet i pokušaj ponovo.';

  // ------------------------------------------------------------------
  //  Stanje
  // ------------------------------------------------------------------
  const today = new Date();
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY),
    students: [],
    loadedAt: 0,
    view: 'calendar',
    calYear: today.getFullYear(),
    calMonth: today.getMonth(),          // 0-11
    selected: null,                      // 'YYYY-MM-DD'
    editToken: null,                     // samo u memoriji, nikad u storage
    editStudent: null,
  };
  let sb = null;

  // ------------------------------------------------------------------
  //  Pomoćne funkcije
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, '0');

  // Pravi DOM element. Tekst ide isključivo kroz textContent / text node.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // replaceChildren koji preskače null/false (inače bi ispisao "null")
  const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c != null && c !== false));

  const keyOf = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
  const keyOfDate = (dt) => keyOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
  const todayKey = () => keyOfDate(new Date());
  const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

  function fmtLong(k) {
    const dt = parseKey(k);
    return `${DAYS[dt.getDay()]}, ${dt.getDate()}. ${MONTHS_GEN[dt.getMonth()]} ${dt.getFullYear()}.`;
  }
  function fmtShort(k) {
    const dt = parseKey(k);
    return `${DAYS[dt.getDay()].slice(0, 3)} ${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.`;
  }
  const fmtBirthday = (s) => (s.birth_month ? `${pad(s.birth_day)}.${pad(s.birth_month)}.` : '—');
  const firstName = (name) => name.split(' ')[0];

  // srpska množina: 1 dan, 2 dana, 5 dana / 1 sat, 2 sata, 5 sati
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function relTime(iso) {
    const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return 'upravo';
    const min = Math.floor(sec / 60);
    if (min < 60) return `pre ${min} ${plural(min, 'minut', 'minuta', 'minuta')}`;
    const h = Math.floor(min / 60);
    if (h < 24) return `pre ${h} ${plural(h, 'sat', 'sata', 'sati')}`;
    const d = Math.floor(h / 24);
    return `pre ${d} ${plural(d, 'dan', 'dana', 'dana')}`;
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function setBusy(form, busy) {
    form.querySelectorAll('button, input, select, textarea').forEach((x) => { x.disabled = busy; });
    form.classList.toggle('busy', busy);
  }

  function showFatal(msg) {
    $('pin-screen').hidden = true;
    $('app').hidden = true;
    const f = $('fatal');
    f.replaceChildren(el('div', { class: 'sheet pin-sheet' },
      el('h1', { text: 'Nešto nije u redu' }),
      el('p', { text: msg })));
    f.hidden = false;
  }

  // ------------------------------------------------------------------
  //  Server
  // ------------------------------------------------------------------
  async function rpc(name, params) {
    let res;
    try {
      res = await sb.rpc(name, params);
    } catch (e) {
      console.error(e);
      throw new Error(NETWORK_ERROR);
    }
    if (res.error) {
      console.error(res.error);
      throw new Error(NETWORK_ERROR);
    }
    return res.data;
  }

  const errText = (r) => r.message || ERRORS[r.error] || 'Došlo je do greške.';

  async function loadOverview() {
    const r = await rpc('get_overview', { p_token: state.token });
    if (!r.ok) {
      if (r.error === 'sesija_istekla') {
        forgetSession();
        showPin(ERRORS.sesija_istekla);
        return false;
      }
      throw new Error(errText(r));
    }
    state.students = r.students;
    state.loadedAt = Date.now();
    renderAll();
    return true;
  }

  function forgetSession() {
    state.token = null;
    state.editToken = null;
    state.editStudent = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

  // ------------------------------------------------------------------
  //  Podaci: rođendani i proslave po danu, preklapanja
  // ------------------------------------------------------------------
  function birthdaysOn(y, m0, d) {
    return state.students.filter((s) => {
      if (!s.birth_month) return false;
      let bd = s.birth_day;
      // 29. februar u neprestupnoj godini prikazujemo 28.
      if (s.birth_month === 2 && bd === 29 && !isLeap(y)) bd = 28;
      return s.birth_month === m0 + 1 && bd === d;
    });
  }
  const partiesOn = (k) => state.students.filter((s) => s.party_date === k)
    .sort((a, b) => (a.party_time || '').localeCompare(b.party_time || ''));

  // Vikend = petak, subota, nedelja. Vraća ključeve ta tri dana ili null.
  function weekendOf(k) {
    const dt = parseKey(k);
    const dow = dt.getDay();
    if (dow !== 5 && dow !== 6 && dow !== 0) return null;
    const fri = addDays(dt, dow === 5 ? 0 : dow === 6 ? -1 : -2);
    return [0, 1, 2].map((i) => keyOfDate(addDays(fri, i)));
  }

  function overlapsFor(k, excludeId) {
    const wk = weekendOf(k);
    const same = [];
    const weekend = [];
    for (const s of state.students) {
      if (s.id === excludeId || !s.party_date) continue;
      if (s.party_date === k) same.push(s);
      else if (wk && wk.includes(s.party_date)) weekend.push(s);
    }
    const dt = parseKey(k);
    const bdays = birthdaysOn(dt.getFullYear(), dt.getMonth(), dt.getDate())
      .filter((s) => s.id !== excludeId);
    return { same, weekend, bdays, isWeekend: !!wk };
  }

  // ------------------------------------------------------------------
  //  Školski kalendar (raspusti, praznici, dani bez nastave)
  // ------------------------------------------------------------------
  const SCHOOL = window.SCHOOL_CALENDAR || { events: [] };
  const schoolEvents = (k) => SCHOOL.events.filter((e) => k >= e.from && k <= (e.to || e.from));
  const noClasses = (k) => schoolEvents(k).some((e) => e.type !== 'oznaka');
  const isBreak = (k) => schoolEvents(k).some((e) => e.type === 'raspust');

  function isSchoolDay(k) {
    const dow = parseKey(k).getDay();
    if (dow === 0 || dow === 6) return false;
    if (!SCHOOL.firstDay || k < SCHOOL.firstDay || k > SCHOOL.lastDay) return false;
    return !noClasses(k);
  }

  function fmtRange(from, to) {
    const a = parseKey(from);
    if (!to || to === from) return `${a.getDate()}. ${MONTHS_GEN[a.getMonth()]}`;
    const b = parseKey(to);
    return a.getMonth() === b.getMonth()
      ? `od ${a.getDate()}. do ${b.getDate()}. ${MONTHS_GEN[b.getMonth()]}`
      : `od ${a.getDate()}. ${MONTHS_GEN[a.getMonth()]} do ${b.getDate()}. ${MONTHS_GEN[b.getMonth()]}`;
  }

  // tekstovi za taj dan: raspust prvi, sa trajanjem
  function schoolNotes(k) {
    return schoolEvents(k)
      .sort((x, y) => (x.type === 'raspust' ? -1 : 0) - (y.type === 'raspust' ? -1 : 0))
      .map((e) => (e.type === 'raspust' && e.to ? `${e.label}, ${fmtRange(e.from, e.to)}` : e.label));
  }

  // ------------------------------------------------------------------
  //  .ics
  // ------------------------------------------------------------------
  function downloadIcs(list, filename) {
    const withDate = list.filter((s) => s.party_date);
    if (!withDate.length) { toast('Nema proslava sa datumom.'); return; }
    window.ICS.download(filename, window.ICS.calendar(withDate, cfg.PARTY_HOURS || 4));
  }
  const icsOne = (s) => downloadIcs([s], `proslava-${window.ICS.slug(s.full_name)}.ics`);

  // ------------------------------------------------------------------
  //  Prikaz: zajednički delovi
  // ------------------------------------------------------------------
  // Po prezimenu pa po imenu, po AZBUCI kao u dnevniku (A B V G D Đ E Ž Z I J K L Lj M N Nj
  // O P R S T Ć U F H C Č Dž Š). Imena su na latinici, pa ih za poređenje prevodimo u ćirilicu.
  const collator = new Intl.Collator('sr-Cyrl');
  const LAT2CYR = { a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', đ: 'ђ', e: 'е', ž: 'ж', z: 'з', i: 'и', j: 'ј',
    k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', ć: 'ћ', u: 'у', f: 'ф',
    h: 'х', c: 'ц', č: 'ч', š: 'ш' };
  const toCyr = (s) => s.toLowerCase().replace(/lj/g, 'љ').replace(/nj/g, 'њ').replace(/dž/g, 'џ')
    .replace(/[a-zđžćčš]/g, (ch) => LAT2CYR[ch] || ch);
  const surnameKey = (name) => { const p = name.split(' '); return [toCyr(p.slice(1).join(' ')), toCyr(p[0])]; };
  function bySurname(a, b) {
    const [sa, fa] = surnameKey(a.full_name), [sb, fb] = surnameKey(b.full_name);
    return collator.compare(sa, sb) || collator.compare(fa, fb);
  }

  const isConfirmed = (s) => s.status === 'potvrdjeno';
  const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

  // "Ana Anić" -> "Ana A." (dovoljno kratko za ćeliju kalendara)
  function shortName(name) {
    const [first, last] = name.split(' ');
    return last ? `${first} ${last[0]}.` : first;
  }

  // Jednostavne ikonice (linijske, 24x24). Pravljene preko DOM-a, bez innerHTML.
  const ICONS = {
    clock: ['M12 7v5l3 2', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
    pin: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M14.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
    cake: ['M4 21h16', 'M5 21v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6', 'M5 17c2.3 1.3 4.7 1.3 7 0s4.7-1.3 7 0', 'M12 13V9', 'M12 4.5c-.9 1.1-.9 2.2 0 2.7.9-.5.9-1.6 0-2.7z'],
    calPlus: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4', 'M16 3v4', 'M12 13v5', 'M9.5 15.5h5'],
    alert: ['M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z', 'M12 10v4', 'M12 17.5v.01'],
    download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
    school: ['M3 9l9-5 9 5-9 5-9-5z', 'M7 11.2V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.8', 'M21 9v6'],
  };
  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ic' })) {
      svg.setAttribute(k, v);
    }
    for (const d of ICONS[name]) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }
  // ikonica + tekst u jednom redu
  const withIcon = (name, text, cls = 'mi') => el('span', { class: cls }, icon(name), el('span', { text }));

  function statusMark(s) {
    return el('span', { class: `st ${isConfirmed(s) ? 'st-ok' : 'st-tent'}`, text: STATUS_LABEL[s.status] || s.status });
  }

  function icsButton(s) {
    return el('button', { type: 'button', class: 'btn-text small',
      'aria-label': `Dodaj proslavu (${s.full_name}) u svoj kalendar`, onclick: () => icsOne(s) },
      icon('calPlus'), 'Dodaj u kalendar');
  }

  function partyMeta(s) {
    if (!s.party_time && !s.party_place) return null;
    return el('div', { class: 'meta' },
      s.party_time ? withIcon('clock', s.party_time) : null,
      s.party_place ? withIcon('pin', s.party_place) : null);
  }

  function birthdayLine(s, year) {
    const text = s.birth_month
      ? `rođendan ${fmtBirthday(s)}${year === YEAR_18 ? ', puni 18' : ''}`
      : 'datum rođenja nije upisan';
    return withIcon('cake', text, 'mi meta-bday');
  }

  function renderAll() {
    renderCalendar();
    renderDay();
    renderList();
    renderStudentSelect();
  }

  // ------------------------------------------------------------------
  //  Kalendar
  // ------------------------------------------------------------------
  function renderCalendar() {
    const y = state.calYear, m0 = state.calMonth;
    fill($('cal-title'), MONTHS[m0], el('small', { text: String(y) }));

    const cells = [];
    const offset = (new Date(y, m0, 1).getDay() + 6) % 7;   // ponedeljak = 0
    for (let i = 0; i < offset; i++) cells.push(el('span', { class: 'day empty', 'aria-hidden': 'true' }));

    const tk = todayKey();
    for (let d = 1; d <= daysInMonth(y, m0); d++) {
      const k = keyOf(y, m0, d);
      const bdays = birthdaysOn(y, m0, d);
      const parties = partiesOn(k);
      const dow = new Date(y, m0, d).getDay();

      const bars = el('span', { class: 'bars' },
        bdays.map((s) => el('span', { class: 'bar bar-bday' },
          el('span', { class: 'bar-txt', text: shortName(s.full_name) }))),
        parties.map((s) => el('span', { class: `bar ${isConfirmed(s) ? 'bar-party' : 'bar-tent'}` },
          el('span', { class: 'bar-txt', text: shortName(s.full_name) }))));

      const desc = [
        ...schoolNotes(k),
        ...bdays.map((s) => `rođendan: ${s.full_name}`),
        ...parties.map((s) => `proslava: ${s.full_name}, ${STATUS_LABEL[s.status]}`),
      ];

      const cls = ['day'];
      if (k === tk) cls.push('today');
      if (k === state.selected) cls.push('selected');
      if (dow === 5 || dow === 6 || dow === 0) cls.push('wk');
      if (isBreak(k)) cls.push('break');
      else if (noClasses(k)) cls.push('off');

      cells.push(el('button', {
        type: 'button',
        class: cls.join(' '),
        'aria-label': `${d}. ${MONTHS_GEN[m0]}${desc.length ? '. ' + desc.join('; ') : ''}`,
        'aria-pressed': k === state.selected ? 'true' : 'false',
        onclick: () => { state.selected = k; renderCalendar(); renderDay(); },
      }, el('span', { class: 'num', text: d }), bars));
    }
    fill($('cal-grid'), cells);
  }

  function renderDay() {
    const box = $('day-details');
    const k = state.selected;
    if (!k) {
      fill(box, el('p', { class: 'muted', text: 'Izaberi dan u kalendaru da vidiš ko slavi.' }));
      return;
    }
    const dt = parseKey(k);
    const bdays = birthdaysOn(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const parties = partiesOn(k);
    const rows = [];

    for (const s of bdays) {
      rows.push(el('li', {},
        el('div', { class: 'when when-bday' }, icon('cake'), el('small', { text: 'rođendan' })),
        el('div', {},
          el('span', { class: 'who hl-pink', text: s.full_name }),
          el('div', { class: 'meta', text: dt.getFullYear() === YEAR_18 ? 'Rođen/a na današnji dan, puni 18.' : 'Rođen/a na današnji dan.' }))));
    }
    for (const s of parties) {
      rows.push(el('li', {},
        el('div', { class: 'when' }, s.party_time || '–', el('small', { text: 'proslava' })),
        el('div', {},
          el('span', { class: 'who', text: s.full_name }), statusMark(s),
          s.party_place ? el('div', { class: 'meta' }, withIcon('pin', s.party_place)) : null,
          s.note ? el('p', { class: 'note', text: s.note }) : null,
          el('div', { class: 'row-foot' }, icsButton(s)))));
    }

    const notes = schoolNotes(k);
    fill(box,
      el('h3', { class: 'day-title cap', text: fmtLong(k) }),
      notes.length ? el('p', { class: 'school-note' }, withIcon('school', notes.join('. '))) : null,
      parties.length > 1 ? el('p', { class: 'warn' }, withIcon('alert', `Ovog dana su ${parties.length} proslave.`)) : null,
      rows.length ? el('ul', { class: 'agenda' }, rows)
        : el('p', { class: 'empty-day', text: 'Ovog dana nema ni rođendana ni proslava.' }));
  }

  // ------------------------------------------------------------------
  //  Spisak
  // ------------------------------------------------------------------
  function renderList() {
    const all = state.students;
    const withDate = all.filter((s) => s.party_date)
      .sort((a, b) => (a.party_date + (a.party_time || '')).localeCompare(b.party_date + (b.party_time || '')));
    const noDate = all.filter((s) => !s.party_date)
      .sort(bySurname);

    const pct = all.length ? Math.round((withDate.length / all.length) * 100) : 0;
    fill($('list-summary'),
      el('p', { text: noDate.length
        ? `${withDate.length} od ${all.length} ima datum proslave. Još ${noDate.length} bez datuma.`
        : `Svih ${all.length} ima datum proslave.` }),
      el('div', { class: 'progress', role: 'img', 'aria-label': `${pct}% ima datum` },
        el('span')),
      el('button', { type: 'button', class: 'btn btn-sm',
        disabled: withDate.length ? null : true,
        onclick: () => downloadIcs(withDate, 'proslave-odeljenja.ics') },
        icon('download'), 'Sve proslave u moj kalendar'));
    // širina trake preko CSSOM-a (CSP ne dozvoljava inline style atribut)
    $('list-summary').querySelector('.progress span').style.width = `${pct}%`;

    const tk = todayKey();
    const upcoming = withDate.filter((s) => s.party_date >= tk);
    const pastOnes = withDate.filter((s) => s.party_date < tk);

    const partyRow = (s) => {
      const past = s.party_date < tk;
      const dt = parseKey(s.party_date);
      const ov = overlapsFor(s.party_date, s.id);
      const clash = [...ov.same, ...ov.weekend];
      return el('li', { class: past ? 'past' : null },
        el('div', { class: 'when' },
          el('span', { class: 'when-day', text: dt.getDate() }),
          el('small', { text: `${MONTHS_SHORT[dt.getMonth()]}, ${DAYS[dt.getDay()].slice(0, 3)}` })),
        el('div', {},
          el('span', { class: 'who', text: s.full_name }), past ? null : statusMark(s),
          partyMeta(s),
          birthdayLine(s, dt.getFullYear()),
          s.note ? el('p', { class: 'note', text: s.note }) : null,
          clash.length && !past ? el('div', { class: 'warn' }, withIcon('alert',
            `${ov.same.length ? 'Istog dana' : 'Istog vikenda'} slavi i: ${clash.map((x) => x.full_name).join(', ')}`)) : null,
          el('div', { class: 'row-foot' },
            el('span', { class: 'muted small', text: `izmenjeno ${relTime(s.updated_at)}` }),
            past ? null : icsButton(s))));
    };

    const noDateRow = (s) => el('li', { class: 'nodate' },
      el('div', { class: 'when' }, el('span', { class: 'when-day pencil', text: '?' })),
      el('div', {},
        el('span', { class: 'who', text: s.full_name }),
        el('div', { class: 'meta pencil', text: 'još nema datum proslave' }),
        birthdayLine(s, null)));

    const section = (title, rows) => (rows.length
      ? el('section', { class: 'sheet' }, el('h3', { class: 'list-head', text: title }), el('ul', { class: 'agenda' }, rows))
      : null);

    if (!all.length) {
      fill($('list'), el('p', { class: 'sheet muted', text: 'Spisak je prazan. Admin još nije dodao učenike.' }));
      return;
    }
    fill($('list'),
      section('Predstojeće proslave', upcoming.map(partyRow)),
      section(`Još nemaju datum proslave (${noDate.length})`, noDate.map(noDateRow)),
      section('Prošle proslave', pastOnes.map(partyRow)));
  }

  // ------------------------------------------------------------------
  //  Moj unos
  // ------------------------------------------------------------------
  function renderStudentSelect() {
    const sel = $('code-student');
    const prev = sel.value;
    const opts = [el('option', { value: '', text: '— izaberi svoje ime —' })];
    [...state.students].sort(bySurname)
      .forEach((s) => opts.push(el('option', { value: s.id, text: s.full_name })));
    sel.replaceChildren(...opts);
    if (prev) sel.value = prev;
  }

  function fillBirthSelects() {
    const d = $('f-bday'), m = $('f-bmonth');
    d.replaceChildren(el('option', { value: '', text: '—' }),
      ...Array.from({ length: 31 }, (_, i) => el('option', { value: i + 1, text: i + 1 })));
    m.replaceChildren(el('option', { value: '', text: '—' }),
      ...MONTHS.map((name, i) => el('option', { value: i + 1, text: name })));
  }

  function openEditor(student) {
    state.editStudent = student;
    $('code-form').hidden = true;
    $('edit-form').hidden = false;
    $('edit-title').textContent = `Zdravo, ${firstName(student.full_name)}!`;
    $('f-bday').value = student.birth_day || '';
    $('f-bmonth').value = student.birth_month || '';
    $('f-date').value = student.party_date || '';
    $('f-time').value = student.party_time || '';
    $('f-place').value = student.party_place || '';
    $('f-note').value = student.note || '';
    document.querySelectorAll('input[name="f-status"]').forEach((r) => { r.checked = r.value === student.status; });
    $('edit-error').textContent = '';
    updateNoteCount();
    updateOverlap();
    updateEditMeta();
  }

  function closeEditor(message) {
    if (state.editToken) rpc('logout', { p_token: state.editToken }).catch(() => {});
    state.editToken = null;
    state.editStudent = null;
    $('edit-form').hidden = true;
    $('code-form').hidden = false;
    $('code-input').value = '';
    $('code-error').textContent = message || '';
  }

  function updateEditMeta() {
    const s = state.editStudent;
    $('edit-meta').textContent = s ? `Poslednja izmena: ${relTime(s.updated_at)}.` : '';
    $('edit-ics').disabled = !(s && s.party_date);
    $('edit-clear').disabled = !(s && s.party_date);
  }

  function updateNoteCount() {
    $('f-note-count').textContent = $('f-note').value.length;
  }

  function updateOverlap() {
    const box = $('overlap');
    const k = $('f-date').value;
    if (!k || !/^\d{4}-\d{2}-\d{2}$/.test(k)) { box.hidden = true; return; }

    const ov = overlapsFor(k, state.editStudent && state.editStudent.id);
    const describe = (s) => {
      const bits = [STATUS_LABEL[s.status]];
      if (s.party_time) bits.push(s.party_time);
      return `${s.full_name} (${bits.join(', ')})`;
    };
    const rows = [el('div', { class: 'overlap-date cap', text: fmtLong(k) })];

    if (ov.same.length) {
      rows.push(el('strong', { text: 'Istog dana slavi:' }),
        el('ul', { class: 'overlap-list' }, ov.same.map((s) => el('li', { text: describe(s) }))));
    }
    if (ov.weekend.length) {
      rows.push(el('strong', { text: 'Istog vikenda (pet–ned) slavi:' }),
        el('ul', { class: 'overlap-list' }, ov.weekend.map((s) =>
          el('li', { text: `${fmtShort(s.party_date)}: ${describe(s)}` }))));
    }
    if (ov.bdays.length) {
      rows.push(el('div', { class: 'muted' }, `Tog dana rođendan ima: ${ov.bdays.map((s) => s.full_name).join(', ')}`));
    }
    // školski kalendar: raspust/praznik tog dana i da li je sutradan nastava
    const notes = schoolNotes(k);
    if (notes.length) rows.push(el('div', { class: 'muted' }, withIcon('school', notes.join('. '))));
    if (isSchoolDay(keyOfDate(addDays(parseKey(k), 1)))) {
      rows.push(el('div', { class: 'muted' }, withIcon('school', 'Sutradan je nastava.')));
    }

    const conflict = ov.same.length || ov.weekend.length;
    if (conflict) {
      rows.push(el('div', { class: 'muted small', text: 'Ovo je samo upozorenje. I dalje možeš da sačuvaš.' }));
    } else {
      rows.push(el('div', { text: ov.isWeekend
        ? 'Tog vikenda (pet–ned) niko drugi ne slavi.'
        : 'Tog dana niko drugi ne slavi.' }));
    }
    box.className = `overlap ${conflict ? 'overlap-warn' : 'overlap-ok'}`;
    box.replaceChildren(...rows);
    box.hidden = false;
  }

  function readEditForm() {
    const status = document.querySelector('input[name="f-status"]:checked');
    const date = $('f-date').value || null;
    return {
      p_edit_token: state.editToken,
      p_birth_month: $('f-bmonth').value ? Number($('f-bmonth').value) : null,
      p_birth_day: $('f-bday').value ? Number($('f-bday').value) : null,
      p_party_date: date,
      p_party_time: date && $('f-time').value ? $('f-time').value : null,
      p_party_place: $('f-place').value.trim() || null,
      p_status: status ? status.value : 'okvirno',
      p_note: $('f-note').value.trim() || null,
    };
  }

  function validateBirth(p) {
    if ((p.p_birth_month == null) !== (p.p_birth_day == null)) return 'Izaberi i dan i mesec rođenja.';
    if (p.p_birth_month && p.p_birth_day > daysInMonth(2028, p.p_birth_month - 1)) return 'Taj datum rođenja ne postoji.';
    return null;
  }

  async function saveEntry(params, okMessage) {
    const form = $('edit-form');
    const err = $('edit-error');
    err.textContent = '';
    const bad = validateBirth(params);
    if (bad) { err.textContent = bad; return; }

    setBusy(form, true);
    try {
      const r = await rpc('save_my_entry', params);
      if (!r.ok) {
        if (r.error === 'sesija_istekla') {
          closeEditor('Sesija za uređivanje je istekla. Unesi kod ponovo.');
          return;
        }
        err.textContent = errText(r);
        return;
      }
      await loadOverview();
      state.editStudent = r.student;
      openEditor(r.student);
      toast(okMessage);
    } catch (e) {
      err.textContent = e.message;
    } finally {
      setBusy(form, false);
      updateEditMeta();
    }
  }

  // ------------------------------------------------------------------
  //  Ekrani i navigacija
  // ------------------------------------------------------------------
  function showPin(message) {
    $('app').hidden = true;
    $('pin-screen').hidden = false;
    $('pin-error').textContent = message || '';
    $('pin-input').value = '';
    setTimeout(() => $('pin-input').focus(), 50);
  }

  function showApp() {
    $('pin-screen').hidden = true;
    $('app').hidden = false;
    setView(state.view);
  }

  function setView(view) {
    state.view = view;
    for (const v of ['calendar', 'list', 'mine']) $(`view-${v}`).hidden = v !== view;
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0 });
  }

  function moveMonth(delta) {
    const d = new Date(state.calYear, state.calMonth + delta, 1);
    state.calYear = d.getFullYear();
    state.calMonth = d.getMonth();
    renderCalendar();
  }

  // ------------------------------------------------------------------
  //  Događaji
  // ------------------------------------------------------------------
  function bindEvents() {
    $('pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const pin = $('pin-input').value;
      if (pin.length < 6) { $('pin-error').textContent = 'PIN ima najmanje 6 karaktera.'; return; }
      $('pin-error').textContent = '';
      setBusy(form, true);
      try {
        const r = await rpc('login', { p_pin: pin });
        if (!r.ok) { $('pin-error').textContent = errText(r); return; }
        state.token = r.token;
        sessionStorage.setItem(TOKEN_KEY, r.token);
        if (await loadOverview()) showApp();
      } catch (err) {
        $('pin-error').textContent = err.message;
      } finally {
        setBusy(form, false);
      }
    });

    $('btn-logout').addEventListener('click', () => {
      const tokens = [state.token, state.editToken].filter(Boolean);
      tokens.forEach((t) => rpc('logout', { p_token: t }).catch(() => {}));
      forgetSession();
      closeEditor();
      showPin('Odjavljen/a si.');
    });

    $('btn-refresh').addEventListener('click', async () => {
      try { if (await loadOverview()) toast('Podaci su osveženi'); } catch (e) { toast(e.message); }
    });

    document.querySelectorAll('.tab').forEach((t) =>
      t.addEventListener('click', () => setView(t.dataset.view)));

    $('cal-prev').addEventListener('click', () => moveMonth(-1));
    $('cal-next').addEventListener('click', () => moveMonth(1));
    $('cal-today').addEventListener('click', () => {
      state.calYear = today.getFullYear();
      state.calMonth = today.getMonth();
      state.selected = todayKey();
      renderCalendar();
      renderDay();
    });

    // prevlačenje levo/desno menja mesec (telefon)
    let touchX = null;
    $('cal-grid').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    $('cal-grid').addEventListener('touchend', (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 60) moveMonth(dx < 0 ? 1 : -1);
    }, { passive: true });

    $('code-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const err = $('code-error');
      const studentId = $('code-student').value;
      const code = $('code-input').value.trim();
      if (!studentId) { err.textContent = 'Izaberi svoje ime.'; return; }
      if (code.replace(/[^A-Za-z0-9]/g, '').length !== 8) { err.textContent = 'Kod ima 8 znakova (npr. ABCD-EFGH).'; return; }
      err.textContent = '';
      setBusy(form, true);
      try {
        const r = await rpc('start_edit', { p_token: state.token, p_student_id: studentId, p_code: code });
        if (!r.ok) {
          if (r.error === 'sesija_istekla') { forgetSession(); showPin(ERRORS.sesija_istekla); return; }
          err.textContent = errText(r);
          return;
        }
        state.editToken = r.edit_token;
        $('code-input').value = '';
        openEditor(r.student);
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        setBusy(form, false);
      }
    });

    $('edit-form').addEventListener('submit', (e) => {
      e.preventDefault();
      saveEntry(readEditForm(), 'Sačuvano');
    });

    $('edit-clear').addEventListener('click', () => {
      if (!window.confirm('Obrisati datum, vreme i mesto proslave? Rođendan i napomena ostaju.')) return;
      const p = readEditForm();
      Object.assign(p, { p_party_date: null, p_party_time: null, p_party_place: null, p_status: 'okvirno' });
      saveEntry(p, 'Proslava je obrisana');
    });

    $('edit-ics').addEventListener('click', () => {
      if (state.editStudent && state.editStudent.party_date) icsOne(state.editStudent);
    });
    $('edit-close').addEventListener('click', () => closeEditor());

    $('f-date').addEventListener('input', updateOverlap);
    $('f-date').addEventListener('change', updateOverlap);
    $('f-note').addEventListener('input', updateNoteCount);

    // kad se aplikacija vrati u fokus posle duže pauze, osveži podatke
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.token && Date.now() - state.loadedAt > 60_000) {
        loadOverview().catch(() => {});
      }
    });
  }

  // ------------------------------------------------------------------
  //  Start
  // ------------------------------------------------------------------
  async function init() {
    const className = cfg.CLASS_NAME || '';
    $('pin-class').textContent = className;
    $('app-class').textContent = className;

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('TVOJ-PROJEKAT')) {
      showFatal('Aplikacija još nije podešena: upiši Supabase URL i anon ključ u config.js.');
      return;
    }
    if (!window.supabase || !window.supabase.createClient) {
      showFatal('Nije učitana Supabase biblioteka. Proveri internet vezu i osveži stranicu.');
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    fillBirthSelects();
    bindEvents();
    state.selected = todayKey();

    if (state.token) {
      try {
        if (await loadOverview()) { showApp(); return; }
      } catch (e) {
        showPin(e.message);
        return;
      }
    }
    showPin();
  }

  init();
})();

// =====================================================================
//  Generisanje .ics (iCalendar) fajlova, potpuno u browseru.
// =====================================================================
'use strict';

window.ICS = (() => {
  const CRLF = '\r\n';

  const VTIMEZONE = [
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Belgrade',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const pad = (n) => String(n).padStart(2, '0');

  // RFC 5545: escape \ ; , i novi red
  function esc(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // RFC 5545: linije najviše 75 bajtova (UTF-8), nastavak počinje razmakom
  const encoder = new TextEncoder();
  function fold(line) {
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const b = encoder.encode(ch).length;
      if (bytes + b > (out.length ? 74 : 75)) {
        out.push(cur);
        cur = '';
        bytes = 0;
      }
      cur += ch;
      bytes += b;
    }
    out.push(cur);
    return out.join(CRLF + ' ');
  }

  function stampUtc(d = new Date()) {
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
           `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  function nextDay(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d + 1);
    return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}`;
  }

  function vevent(s, hours) {
    const date = s.party_date.replace(/-/g, '');
    const lines = [
      'BEGIN:VEVENT',
      `UID:proslava-${s.id}@rodjendani-odeljenja`,
      `DTSTAMP:${stampUtc()}`,
    ];
    if (s.party_time) {
      lines.push(`DTSTART;TZID=Europe/Belgrade:${date}T${s.party_time.replace(':', '')}00`);
      lines.push(`DURATION:PT${hours}H`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${date}`);
      lines.push(`DTEND;VALUE=DATE:${nextDay(s.party_date)}`);
    }
    lines.push(`SUMMARY:${esc('Proslava 18. rođendana: ' + s.full_name)}`);
    if (s.party_place) lines.push(`LOCATION:${esc(s.party_place)}`);
    const desc = [`Status: ${s.status === 'potvrdjeno' ? 'potvrđeno' : 'okvirno'}`];
    if (s.note) desc.push(s.note);
    lines.push(`DESCRIPTION:${esc(desc.join('\n'))}`);
    lines.push(`STATUS:${s.status === 'potvrdjeno' ? 'CONFIRMED' : 'TENTATIVE'}`);
    lines.push('END:VEVENT');
    return lines;
  }

  function calendar(students, hours = 4) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Rodjendani odeljenja//SR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Proslave odeljenja',
      ...VTIMEZONE,
    ];
    for (const s of students) {
      if (s.party_date) lines.push(...vevent(s, hours));
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join(CRLF) + CRLF;
  }

  function slug(name) {
    return String(name)
      .toLowerCase()
      .replace(/đ/g, 'dj')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'proslava';
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return { calendar, download, slug };
})();

// =====================================================================
//  Školski kalendar 2026/2027 za srednje škole (gimnazija, III razred).
//  Izvor: Pravilnik o kalendaru obrazovno-vaspitnog rada srednje škole
//  za školsku 2026/2027. godinu, "Sl. glasnik RS - Prosvetni glasnik" br. 3/2026.
//  Državni praznici: Zakon o državnim i drugim praznicima u Republici Srbiji.
//  Napomena: škole u AP Vojvodini imaju poseban pravilnik (drugačiji zimski raspust).
//
//  type: 'raspust'   = raspust
//        'praznik'   = državni praznik, ne radi se
//        'bez_nastave' = radni dan, ali nema nastave
//        'oznaka'    = samo informacija (nastava normalno traje)
// =====================================================================
'use strict';

window.SCHOOL_CALENDAR = Object.freeze({
  firstDay: '2026-09-01',   // početak nastave
  lastDay: '2027-06-18',    // kraj nastave za I–III razred gimnazije
  events: [
    { from: '2026-11-11', to: '2026-11-13', type: 'raspust', label: 'Jesenji raspust' },
    { from: '2026-11-11', type: 'praznik', label: 'Dan primirja u Prvom svetskom ratu' },
    { from: '2026-12-31', type: 'bez_nastave', label: 'Radni dan bez nastave' },
    { from: '2027-01-01', to: '2027-01-02', type: 'praznik', label: 'Nova godina' },
    { from: '2027-01-04', to: '2027-01-15', type: 'raspust', label: 'Zimski raspust' },
    { from: '2027-01-07', type: 'praznik', label: 'Božić' },
    { from: '2027-01-18', type: 'oznaka', label: 'Počinje drugo polugodište' },
    { from: '2027-01-27', type: 'bez_nastave', label: 'Sveti Sava, nema nastave' },
    { from: '2027-02-15', to: '2027-02-19', type: 'raspust', label: 'Sretenjski raspust' },
    { from: '2027-02-15', to: '2027-02-16', type: 'praznik', label: 'Sretenje, Dan državnosti' },
    { from: '2027-04-30', to: '2027-05-04', type: 'raspust', label: 'Prolećni raspust' },
    { from: '2027-04-30', to: '2027-05-03', type: 'praznik', label: 'Vaskršnji praznici' },
    { from: '2027-05-01', to: '2027-05-02', type: 'praznik', label: 'Praznik rada' },
    { from: '2027-06-18', type: 'oznaka', label: 'Poslednji dan nastave' },
    { from: '2027-06-21', to: '2027-08-31', type: 'raspust', label: 'Letnji raspust' },
  ],
});

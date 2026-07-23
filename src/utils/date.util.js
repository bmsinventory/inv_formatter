window.SLF = window.SLF || {};

(function(){
  function parseExpireDate(v){
    // SheetJS (cellDates:true) hands back real date-typed cells as a Date whose LOCAL calendar
    // fields are the correct day but whose UTC fields can be a day off (e.g. Bangkok UTC+7 turns
    // 24 Jul local into 23 Jul ~17:00 UTC). Every other date in this app — fmtDate(), the text-parsed
    // branch below, and ExcelJS on export — reads UTC fields, so re-anchor to UTC using the LOCAL
    // fields here or this path silently exports one day early.
    // SheetJS's serial->Date conversion also carries a few seconds of floating-point drift that
    // lands right on the local-midnight boundary, which can tip getFullYear/Month/Date to the wrong
    // side — round to the nearest local midnight first so that drift can never cross a day boundary.
    if(v instanceof Date && !isNaN(v)){
      const DAY_MS = 86400000;
      const offsetMs = v.getTimezoneOffset() * 60000;
      const snappedLocalMs = Math.round((v.getTime() - offsetMs) / DAY_MS) * DAY_MS;
      const snapped = new Date(snappedLocalMs);
      let y = snapped.getUTCFullYear();
      if(y>2400) y -= 543; // source cell was a real Date typed with a Buddhist year (Excel doesn't know BE, so it lands here literally) -> CE
      return new Date(Date.UTC(y, snapped.getUTCMonth(), snapped.getUTCDate()));
    }
    if(!v) return null;
    const s = String(v).trim();
    // short "mm/yy" or "mm/yyyy" with no day — treat as month-only expiry and
    // resolve to the last day of that month (e.g. "12/30" -> 31/12/2030)
    let mShort = s.match(/^(\d{1,2})[\/\-.](\d{2,4})$/);
    if(mShort){
      let [_,mo,y] = mShort; mo=+mo; y=+y;
      if(y<100) y += 2000;
      if(y>2400) y -= 543; // Buddhist Era -> CE
      const dt = new Date(Date.UTC(y, mo, 0)); // day 0 of next month = last day of `mo`
      if(!isNaN(dt)) return dt;
    }
    // try dd/mm/yyyy (Thai) — could be Buddhist year
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if(m){
      let [_,d,mo,y] = m; d=+d; mo=+mo; y=+y;
      if(y<100) y += 2000;
      if(y>2400) y -= 543; // Buddhist Era -> CE
      // build via UTC, not the local constructor: ExcelJS reads a Date's UTC calendar fields when
      // writing it back out, so a locally-constructed date shifts by a day for any non-zero UTC
      // offset (e.g. Bangkok UTC+7 turns "1 Apr" into "31 Mar 17:00 UTC" → exported as 31 Mar)
      const dt = new Date(Date.UTC(y, mo-1, d));
      if(!isNaN(dt)) return dt;
    }
    const dt2 = new Date(s);
    if(!isNaN(dt2)) return new Date(Date.UTC(dt2.getFullYear(), dt2.getMonth(), dt2.getDate()));
    return null;
  }

  function fmtDate(d){
    if(!d) return '-';
    const dd = String(d.getUTCDate()).padStart(2,'0');
    const mm = String(d.getUTCMonth()+1).padStart(2,'0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // raw cell values may be real Date objects (raw:true read mode) — format those for display
  // instead of letting String(date) print a verbose JS date string in a table cell
  function cellDisplay(v){
    // route through parseExpireDate so a raw real-date Excel cell gets the same UTC re-anchoring
    // as everywhere else in the app — otherwise this preview alone shows the day before
    if(v instanceof Date && !isNaN(v)) return fmtDate(parseExpireDate(v));
    return v;
  }

  SLF.utils = SLF.utils || {};
  SLF.utils.date = { parseExpireDate, fmtDate, cellDisplay };
})();

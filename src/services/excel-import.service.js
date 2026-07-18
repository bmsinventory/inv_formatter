window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function handleFile(file){
    const ext = file.name.split('.').pop().toLowerCase();
    if(!['xlsx','xls','csv'].includes(ext)){
      SLF.components.toast('รองรับเฉพาะไฟล์ .xlsx, .xls หรือ .csv เท่านั้น','err');
      return;
    }
    SLF.components.showLoading('กำลังอ่านไฟล์...');
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, {type:'array', cellDates:true});
        S().workbook = wb;
        S().fileName = file.name;
        S().fileSize = file.size;
        S().fileExt = ext;
        S().sheetNames = wb.SheetNames;
        S().selectedSheet = wb.SheetNames[0];
        loadSheetPreview(S().selectedSheet);
        SLF.components.hideLoading();
        // Reading the file completes step 1; continue directly to sheet/header selection.
        S().step = 2;
        SLF.components.toast('อ่านไฟล์สำเร็จ','ok');
        SLF.router.render();
      }catch(err){
        SLF.components.hideLoading();
        SLF.components.toast('ไม่สามารถอ่านไฟล์นี้ได้: '+err.message,'err');
      }
    };
    reader.onerror = ()=>{ SLF.components.hideLoading(); SLF.components.toast('เกิดข้อผิดพลาดขณะอ่านไฟล์','err'); };
    reader.readAsArrayBuffer(file);
  }

  function loadSheetPreview(sheetName){
    const ws = S().workbook.Sheets[sheetName];
    // raw:true so date-typed cells come through as real Date objects (cellDates:true) instead of
    // pre-formatted text — with raw:false, SheetJS renders dates using the cell's own number format,
    // which can be d/m/y, m/d/y, or anything else depending on how the source file was authored, and
    // our own d/m/y text parsing below would then silently misread ambiguous or non-d/m/y dates
    const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', raw:true});
    S().sheetRawRows = rows;
    // guess header row: first row (within first 5) with the most non-empty cells
    let bestIdx=0, bestScore=-1;
    for(let i=0;i<Math.min(5, rows.length);i++){
      const filled = rows[i].filter(v=> String(v).trim()!=='').length;
      if(filled>bestScore){ bestScore=filled; bestIdx=i; }
    }
    S().headerRowIndex = bestIdx;
    applyHeaderRow(bestIdx);
  }

  function applyHeaderRow(idx){
    S().headerRowIndex = idx;
    const rows = S().sheetRawRows;
    const raw = (rows[idx]||[]).map((h,i)=> String(h).trim() || ('คอลัมน์ '+(i+1)));
    // files with repeated Lot/Exp/คงเหลือ column blocks (Lot No.1, Lot No.2, …) often reuse the
    // exact same header text per block — disambiguate so each column keeps its own data instead
    // of later columns silently overwriting earlier ones with the same header name
    const seen = {};
    S().headers = raw.map(h=>{
      seen[h] = (seen[h]||0) + 1;
      return seen[h]===1 ? h : `${h} (${seen[h]})`;
    });
    autoMapColumns();
  }

  function autoMapColumns(){
    const FIELD_DEFS = SLF.config.FIELD_DEFS;
    const MULTI_FIELDS = SLF.config.MULTI_FIELDS;
    const KEYWORDS = SLF.config.KEYWORDS;
    const norm = SLF.utils.string.normalize;

    const used = new Set();
    const map = {};
    // manual fields (รหัสคลัง/รหัสบริษัท) aren't derived from headers — carry over whatever the
    // user already typed so re-picking the header row doesn't wipe it out
    FIELD_DEFS.forEach(fd=>{
      if(fd.kind==='manual') map[fd.key] = (S().mapping && S().mapping[fd.key]) || '';
      else if(fd.kind==='file') map[fd.key] = MULTI_FIELDS.includes(fd.key) ? [] : '';
    });
    // two passes: claim every EXACT keyword match first (across all fields), then fall back to loose
    // substring matches for whatever's left. This stops a generic substring (e.g. "qty") in one field's
    // keyword list from stealing a header that another field matches exactly (e.g. item_unit_qty should
    // go to pack_size, not get vacuumed up by qty's substring check first)
    const fileFields = FIELD_DEFS.filter(fd=>fd.kind==='file');
    fileFields.forEach(fd=>{
      const kws = KEYWORDS[fd.key].map(norm);
      const isMulti = MULTI_FIELDS.includes(fd.key);
      for(const h of S().headers){
        if(used.has(h)) continue;
        if(!kws.includes(norm(h))) continue;
        if(isMulti){ map[fd.key].push(h); used.add(h); }
        else { map[fd.key] = h; used.add(h); break; }
      }
    });
    fileFields.forEach(fd=>{
      if(!MULTI_FIELDS.includes(fd.key) && map[fd.key]) return; // single-select already exact-matched
      const kws = KEYWORDS[fd.key].map(norm);
      const isMulti = MULTI_FIELDS.includes(fd.key);
      for(const h of S().headers){
        if(used.has(h)) continue;
        const nh = norm(h);
        if(!kws.some(k=> nh.includes(k) && k.length>=3)) continue;
        if(isMulti){ map[fd.key].push(h); used.add(h); }
        else { map[fd.key] = h; used.add(h); break; }
      }
    });
    S().mapping = map;
    // opt-in only: the export is a fixed 16-column template, so unmapped source columns are dropped
    // by default — the user explicitly ticks any they want carried through as extra columns
    S().extraCols = [];
  }

  function buildDataRows(){
    const rows = S().sheetRawRows;
    const out = [];
    for(let i=S().headerRowIndex+1; i<rows.length; i++){
      const r = rows[i];
      if(!r || r.every(v=> String(v).trim()==='')) continue;
      const obj = {__rowNum: i+1};
      S().headers.forEach((h,ci)=>{ obj[h] = r[ci]!==undefined? r[ci] : ''; });
      out.push(obj);
    }
    S().dataRows = out;
    SLF.pages.upload.renderFileChip();
  }

  SLF.services = SLF.services || {};
  SLF.services.excelImport = { handleFile, loadSheetPreview, applyHeaderRow, autoMapColumns, buildDataRows };
})();

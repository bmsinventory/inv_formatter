window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStep1(c){
    c.innerHTML = `
      <div class="panel">
        <h2>1. อัปโหลดไฟล์ข้อมูลสต็อก</h2>
        <p class="sub">รองรับไฟล์ .xlsx, .xls และ .csv — ข้อมูลทั้งหมดจะถูกประมวลผลในเบราว์เซอร์ของคุณเท่านั้น ไม่มีการส่งไฟล์ออกไปที่เซิร์ฟเวอร์ภายนอก</p>
        <div class="dropzone" id="dropzone">
          <div class="icon">📄</div>
          <h3>ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</h3>
          <p>.xlsx · .xls · .csv</p>
          <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
        <div id="fileChipHolder"></div>
      </div>
    `;
    const dz = document.getElementById('dropzone');
    const input = document.getElementById('fileInput');
    dz.onclick = ()=> input.click();
    ['dragenter','dragover'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e=>{
      const f = e.dataTransfer.files[0];
      if(f) SLF.services.excelImport.handleFile(f);
    });
    input.addEventListener('change', e=>{
      const f = e.target.files[0];
      if(f) SLF.services.excelImport.handleFile(f);
    });
    renderFileChip();
  }

  function renderFileChip(){
    const escapeHtml = SLF.utils.string.escapeHtml;
    const holder = document.getElementById('fileChipHolder');
    if(!holder) return;
    if(!S().fileName){ holder.innerHTML=''; return; }
    const kb = (S().fileSize/1024).toFixed(1);
    holder.innerHTML = `
      <div class="file-chip">
        <div>
          <div class="name">${escapeHtml(S().fileName)}</div>
          <div class="meta">${kb} KB · ${S().sheetNames.length} sheet(s)${S().dataRows.length? ' · '+S().dataRows.length+' แถวข้อมูล':''}</div>
        </div>
        <span class="badge badge-ok">อัปโหลดสำเร็จ</span>
      </div>`;
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.upload = { renderStep1, renderFileChip };
})();

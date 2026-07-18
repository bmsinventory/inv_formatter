window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStep7(c){
    const stats = SLF.core.computeStats();
    c.innerHTML = `
      <div class="panel">
        <h2>7. ส่งออกไฟล์ Excel</h2>
        <p class="sub">ไฟล์ผลลัพธ์จะคงลำดับสินค้าและ LOT ตามที่ตรวจสอบไว้ พร้อมจัดรูปแบบ (Freeze Header, Auto Filter, ไฮไลต์สินค้าหลาย LOT)</p>
        <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="stat-card"><div class="n">${stats.formattedRows}</div><div class="l">แถวที่จะส่งออก</div></div>
          <div class="stat-card"><div class="n">${stats.uniqueItems}</div><div class="l">สินค้าไม่ซ้ำ</div></div>
          <div class="stat-card warn"><div class="n">${stats.withMultiLot}</div><div class="l">สินค้าที่มีมากกว่า 1 LOT (ไฮไลต์)</div></div>
        </div>
        <div class="toggle-row">
          <div><div class="t">รูปแบบการแสดงผลในไฟล์ Excel</div><div class="d">${S().settings.displayMode==='sparse'?'แสดงชื่อสินค้าแถวแรกเท่านั้น (แบบที่ 2)':'แสดงข้อมูลสินค้าซ้ำทุกแถว (แบบที่ 1)'} — แก้ไขได้ที่ขั้นตอนที่ 4</div></div>
        </div>
        <div style="margin-top:22px">
          <button class="btn btn-primary" id="btnExport" style="padding:12px 26px;font-size:14.5px">⬇ ดาวน์โหลดไฟล์ Excel</button>
        </div>
        <div id="exportStatus" class="hint" style="margin-top:10px"></div>
      </div>
    `;
    document.getElementById('btnExport').onclick = SLF.services.excelExport.doExport;
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.exportPage = { renderStep7 };
})();

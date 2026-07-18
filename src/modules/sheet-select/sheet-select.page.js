window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStep2(c){
    const escapeHtml = SLF.utils.string.escapeHtml;
    const cellDisplay = SLF.utils.date.cellDisplay;
    const rows = S().sheetRawRows.slice(0, 12);
    c.innerHTML = `
      <div class="panel">
        <h2>2. เลือก Sheet และแถวหัวตาราง</h2>
        <p class="sub">คลิกที่แถวในตารางด้านล่างเพื่อกำหนดว่าแถวใดคือ "หัวตาราง" (บางไฟล์อาจมีหลายแถวหัวตารางซ้อนกัน)</p>
        <div class="field" style="max-width:320px">
          <label class="field-label">Sheet</label>
          <select id="sheetSelect">
            ${S().sheetNames.map(n=>`<option value="${escapeHtml(n)}" ${n===S().selectedSheet?'selected':''}>${escapeHtml(n)}</option>`).join('')}
          </select>
        </div>
        <div class="table-scroll" style="max-height:400px">
          <table class="data" id="headerPickTable">
            <tbody>
              ${rows.map((r,i)=>`
                <tr class="hdr-candidate ${i===S().headerRowIndex?'hdr-chosen':''}" data-idx="${i}">
                  <td style="color:var(--ink-soft);width:34px">${i+1}</td>
                  ${r.map(cell=>`<td>${escapeHtml(cellDisplay(cell))}</td>`).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="hint">แถวที่เลือกอยู่: แถวที่ ${S().headerRowIndex+1} — พบ ${S().headers.length} คอลัมน์ และมีข้อมูล ${Math.max(0, S().sheetRawRows.length - S().headerRowIndex - 1)} แถวถัดจากหัวตาราง</p>
      </div>
    `;
    document.getElementById('sheetSelect').onchange = (e)=>{
      S().selectedSheet = e.target.value;
      SLF.services.excelImport.loadSheetPreview(S().selectedSheet);
      SLF.router.render();
    };
    c.querySelectorAll('#headerPickTable tr.hdr-candidate').forEach(tr=>{
      tr.onclick = ()=>{
        SLF.services.excelImport.applyHeaderRow(parseInt(tr.dataset.idx,10));
        SLF.router.render();
      };
    });
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.sheetSelect = { renderStep2 };
})();

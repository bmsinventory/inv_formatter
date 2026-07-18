window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStep5(c){
    const escapeHtml = SLF.utils.string.escapeHtml;
    // Step 5 is an action screen: only blocking errors need to be shown here.
    // Warnings and informational findings remain in state for the processing logic,
    // but do not add noise to this table.
    const issues = S().issues.filter(i=>i.severity==='error');
    const errCount = issues.filter(i=>i.severity==='error').length;
    const warnCount = issues.filter(i=>i.severity==='warning').length;
    const infoCount = issues.filter(i=>i.severity==='info').length;

    // group issues by row for display
    const byRow = {};
    issues.forEach(is=>{ (byRow[is.rowNum] = byRow[is.rowNum]||[]).push(is); });
    const rowNums = Object.keys(byRow).map(Number).sort((a,b)=>a-b);
    const dataByRow = {};
    S().dataRows.forEach(row=>{ dataByRow[row.__rowNum] = row; });
    const invHeader = S().mapping.inv_code;
    const nameHeader = S().mapping.item_name;

    c.innerHTML = `
      <div class="panel">
        <h2>5. ตรวจสอบข้อมูล</h2>
        <p class="sub">ระบบตรวจพบรายการที่ควรตรวจสอบดังนี้ กรุณาเลือกวิธีจัดการแต่ละแถว หรือปล่อยให้ใช้ค่าเริ่มต้น</p>
        <div class="stat-grid validation-error-stats">
          <div class="stat-card danger"><div class="n">${errCount}</div><div class="l">ข้อผิดพลาด (Error)</div></div>
          <div class="stat-card warn"><div class="n">${warnCount}</div><div class="l">คำเตือน (Warning)</div></div>
          <div class="stat-card"><div class="n">${infoCount}</div><div class="l">ข้อมูลแจ้งให้ทราบ</div></div>
          <div class="stat-card"><div class="n">${S().dataRows.length - rowNums.length}</div><div class="l">แถวที่ไม่มีปัญหา</div></div>
        </div>
        ${rowNums.length===0 ? `
          <div class="empty"><div class="icon">✅</div>ไม่พบข้อผิดพลาดในข้อมูล — พร้อมดำเนินการต่อ</div>
        ` : `
        <div style="margin-bottom:10px;display:flex;gap:10px">
          <button class="btn btn-sm" id="btnKeepAll">ใช้ตามเดิมทั้งหมด</button>
          <button class="btn btn-sm btn-danger" id="btnSkipAllErr">ข้ามแถวที่มี Error ทั้งหมด</button>
        </div>
        <div class="table-scroll" style="max-height:420px">
          <table class="data">
            <thead><tr><th>แถวที่</th><th>รหัส INV</th><th>ชื่อรายการ</th><th>รายละเอียดปัญหา</th><th>วิธีจัดการ / เหตุผล</th></tr></thead>
            <tbody>
              ${rowNums.map(rn=>{
                const list = byRow[rn];
                const sourceRow = dataByRow[rn] || {};
                const invCode = invHeader ? sourceRow[invHeader] : '';
                const itemName = nameHeader ? sourceRow[nameHeader] : '';
                const resolutionReason = S().rowResolutionReason[rn] || (S().rowResolution[rn]==='keep' ? 'ผู้ใช้เลือกใช้ข้อมูลรายการนี้ตามเดิม' : 'ผู้ใช้เลือกข้ามข้อมูลรายการนี้');
                return `<tr>
                  <td class="mono">#${rn}</td>
                  <td class="mono">${escapeHtml(invCode || '-')}</td>
                  <td>${escapeHtml(itemName || '-')}</td>
                  <td>${list.map(x=>`<span class="badge badge-${x.severity==='error'?'danger':x.severity==='warning'?'warn':'ok'}" style="margin:2px 4px 2px 0">${escapeHtml(x.message)}</span>`).join('')}</td>
                  <td>
                    <select data-rn="${rn}" style="min-width:160px">
                      <option value="keep" ${S().rowResolution[rn]==='keep'?'selected':''}>ใช้ตามเดิม</option>
                      <option value="skip" ${S().rowResolution[rn]==='skip'?'selected':''}>ข้ามรายการนี้</option>
                    </select>
                    <div class="resolution-reason ${S().rowResolution[rn]==='keep'?'keep':'skip'}">${escapeHtml(resolutionReason)}</div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    `;
    if(rowNums.length>0){
      c.querySelectorAll('select[data-rn]').forEach(sel=>{
        sel.onchange = ()=>{
          const rn = parseInt(sel.dataset.rn,10);
          S().rowResolution[rn] = sel.value;
          S().rowResolutionReason[rn] = sel.value==='keep'
            ? 'ผู้ใช้เลือกใช้ข้อมูลรายการนี้ตามเดิม'
            : 'ผู้ใช้เลือกข้ามข้อมูลรายการนี้';
          SLF.router.render();
        };
      });
      document.getElementById('btnKeepAll').onclick = ()=>{
        rowNums.forEach(rn=>{
          S().rowResolution[rn]='keep';
          S().rowResolutionReason[rn]='ผู้ใช้เลือกใช้ข้อมูลรายการนี้ตามเดิม';
        });
        SLF.router.render();
      };
      document.getElementById('btnSkipAllErr').onclick = ()=>{
        rowNums.forEach(rn=>{
          if(byRow[rn].some(x=>x.severity==='error')){
            S().rowResolution[rn]='skip';
            S().rowResolutionReason[rn]='ผู้ใช้เลือกข้ามข้อมูลรายการนี้';
          }
        });
        SLF.router.render();
      };
    }
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.validation = { renderStep5 };
})();

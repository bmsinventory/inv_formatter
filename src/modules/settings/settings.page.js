window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStep4(c){
    const LOT_SORT_OPTS = SLF.config.LOT_SORT_OPTS;
    const DISPLAY_OPTS = SLF.config.DISPLAY_OPTS;
    const escapeHtml = SLF.utils.string.escapeHtml;

    c.innerHTML = `
      <div class="panel">
        <h2>4. ตั้งค่าการจัดเรียงและการแสดงผล</h2>
        <p class="sub">กำหนดวิธีเรียง LOT ภายในสินค้าแต่ละรายการ และรูปแบบการแสดงผลลัพธ์</p>
        <div class="section-title">วิธีเรียง LOT ภายในสินค้าเดียวกัน</div>
        <div class="radio-row" id="lotSortRow">
          ${LOT_SORT_OPTS.map(o=>`
            <div class="radio-card ${S().settings.lotSort===o.v?'sel':''}" data-v="${o.v}">
              <span class="t">${o.t}</span><span class="d">${o.d}</span>
            </div>`).join('')}
        </div>
        <div class="section-title">รูปแบบการแสดงข้อมูลหลาย LOT</div>
        <div class="radio-row" id="displayRow">
          ${DISPLAY_OPTS.map(o=>`
            <div class="radio-card ${S().settings.displayMode===o.v?'sel':''}" data-v="${o.v}">
              <span class="t">${o.t}</span><span class="d">${o.d}</span>
            </div>`).join('')}
        </div>
        <div class="section-title">ตัวเลือกเพิ่มเติม</div>
        <div class="toggle-row">
          <div><div class="t">รวมจำนวนหาก LOT ซ้ำกันในสินค้าเดียวกัน</div><div class="d">ถ้าไม่เปิด ระบบจะแสดงเป็นแถวแยกและแจ้งเตือนในขั้นตอนตรวจสอบ</div></div>
          <label class="switch"><input type="checkbox" id="swMerge" ${S().settings.mergeDuplicateLot?'checked':''}><span class="slider"></span></label>
        </div>
        <div class="grid grid-2" style="margin-top:16px">
          <div class="field">
            <label class="field-label">แจ้งเตือนสินค้าใกล้หมดอายุ (ภายในกี่วัน)</label>
            <input type="number" id="expWarnDays" value="${S().settings.expiryWarnDays}" min="0">
          </div>
          <div class="field">
            <label class="field-label">ข้อความแทนกรณีไม่มี LOT</label>
            <input type="text" id="noLotLabel" value="${escapeHtml(S().settings.noLotLabel)}">
          </div>
        </div>
      </div>
    `;
    c.querySelectorAll('#lotSortRow .radio-card').forEach(card=>{
      card.onclick = ()=>{ S().settings.lotSort = card.dataset.v; SLF.router.render(); };
    });
    c.querySelectorAll('#displayRow .radio-card').forEach(card=>{
      card.onclick = ()=>{ S().settings.displayMode = card.dataset.v; SLF.router.render(); };
    });
    document.getElementById('swMerge').onchange = e=> S().settings.mergeDuplicateLot = e.target.checked;
    document.getElementById('expWarnDays').onchange = e=> S().settings.expiryWarnDays = parseInt(e.target.value,10)||0;
    document.getElementById('noLotLabel').onchange = e=> S().settings.noLotLabel = e.target.value || 'ไม่ระบุ LOT';
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.settings = { renderStep4 };
})();

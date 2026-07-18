window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStep3(c){
    const FIELD_DEFS = SLF.config.FIELD_DEFS;
    const MULTI_FIELDS = SLF.config.MULTI_FIELDS;
    const escapeHtml = SLF.utils.string.escapeHtml;
    const cellDisplay = SLF.utils.date.cellDisplay;
    const { blockNumberOf, mappedHeaders } = SLF.utils.mapping;

    const sample = S().dataRows[0] || {};
    c.innerHTML = `
      <div class="panel">
        <h2>3. จับคู่คอลัมน์</h2>
        <p class="sub">ระบบจับคู่คอลัมน์อัตโนมัติจากชื่อหัวตาราง กรุณาตรวจสอบและแก้ไขให้ถูกต้อง (<span style="color:var(--amber)">●</span> จำเป็นต้องระบุ) — คอลัมน์ Lot. / Exp. / คงเหลือ สามารถจับคู่ได้มากกว่า 1 คอลัมน์ หากไฟล์มีหลายชุด (เช่น Lot1/Exp1/Qty1, Lot2/Exp2/Qty2)</p>
        <table class="map-table">
          <thead><tr><th>คอลัมน์มาตรฐาน</th><th>คอลัมน์ต้นฉบับ</th><th>ตัวอย่างข้อมูล</th></tr></thead>
          <tbody>
            ${FIELD_DEFS.map(fd=>{
              const isMulti = MULTI_FIELDS.includes(fd.key);
              let mapCell, exampleCell;
              if(fd.kind==='auto'){
                mapCell = `<span class="hint">รันอัตโนมัติ (1, 2, 3, …)</span>`;
                exampleCell = '1, 2, 3, …';
              } else if(fd.kind==='blank'){
                mapCell = `<span class="hint">ว่างเสมอ — ไม่ต้องกรอก</span>`;
                exampleCell = '';
              } else if(fd.kind==='computed'){
                mapCell = `<span class="hint">คำนวณอัตโนมัติ = ราคาต่อหน่วย × คงเหลือ</span>`;
                exampleCell = '';
              } else if(fd.kind==='manual'){
                const val = S().mapping[fd.key];
                mapCell = `<input type="number" data-manual="${fd.key}" value="${escapeHtml(val)}" placeholder="ระบุตัวเลข" style="max-width:160px">`;
                exampleCell = val? escapeHtml(val) : '';
              } else if(isMulti){
                const selected = S().mapping[fd.key];
                mapCell = `
                  <div class="multi-map-chips">
                    ${S().headers.map(h=>{
                      const on = selected.includes(h);
                      return `<label class="chip-filter ${on?'on':''}" style="cursor:pointer">
                        <input type="checkbox" style="display:none" data-multi="${fd.key}" data-h="${escapeHtml(h)}" ${on?'checked':''}> ${escapeHtml(h)}
                      </label>`;
                    }).join('')}
                  </div>
                  ${selected.length>1? `<div class="hint">ลำดับที่จับคู่ (ตามหมายเลขชุด): ${selected.slice().sort((a,b)=>blockNumberOf(a)-blockNumberOf(b)).map(escapeHtml).join(' → ')}</div>`:''}
                `;
                exampleCell = selected.length? selected.map(h=>escapeHtml(cellDisplay(sample[h]))).join(' / ') : '';
              } else {
                const val = S().mapping[fd.key];
                mapCell = `
                  <select data-field="${fd.key}" style="min-width:220px">
                    <option value="">— ไม่ใช้ข้อมูลนี้ —</option>
                    ${S().headers.map(h=>`<option value="${escapeHtml(h)}" ${h===val?'selected':''}>${escapeHtml(h)}</option>`).join('')}
                  </select>
                `;
                exampleCell = val? escapeHtml(cellDisplay(sample[val])) : '';
              }
              return `<tr>
                <td>${fd.label}${fd.required?'<span class="req-dot" title="จำเป็น"></span>':''}</td>
                <td>${mapCell}</td>
                <td class="map-preview">${exampleCell}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="section-title">คอลัมน์อื่น ๆ ที่ต้องการเก็บไว้ในไฟล์ผลลัพธ์ (ไม่บังคับ)</div>
        <div id="extraColsBox" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>
    `;
    c.querySelectorAll('select[data-field]').forEach(sel=>{
      sel.onchange = ()=>{
        S().mapping[sel.dataset.field] = sel.value;
        // a header newly mapped to a real field must drop out of "extra columns" or it'd export twice
        S().extraCols = S().extraCols.filter(h=> !mappedHeaders(S().mapping).includes(h));
        renderExtraColsBox();
      };
    });
    c.querySelectorAll('input[data-manual]').forEach(inp=>{
      inp.onchange = ()=>{ S().mapping[inp.dataset.manual] = inp.value; };
    });
    c.querySelectorAll('input[data-multi]').forEach(inp=>{
      inp.parentElement.onclick = (e)=>{
        e.preventDefault();
        const field = inp.dataset.multi;
        const h = inp.dataset.h;
        const arr = S().mapping[field];
        const idx = arr.indexOf(h);
        if(idx>=0) arr.splice(idx,1); else arr.push(h);
        S().extraCols = S().extraCols.filter(x=> !mappedHeaders(S().mapping).includes(x));
        renderStep3(c);
      };
    });
    renderExtraColsBox();
  }

  function renderExtraColsBox(){
    const escapeHtml = SLF.utils.string.escapeHtml;
    const { mappedHeaders } = SLF.utils.mapping;
    const box = document.getElementById('extraColsBox');
    if(!box) return;
    const mapped = new Set(mappedHeaders(S().mapping));
    const candidates = S().headers.filter(h=> !mapped.has(h));
    box.innerHTML = candidates.map(h=>{
      const on = S().extraCols.includes(h);
      return `<label class="chip-filter ${on?'on':''}" style="cursor:pointer">
        <input type="checkbox" style="display:none" data-extra="${escapeHtml(h)}" ${on?'checked':''}> ${escapeHtml(h)}
      </label>`;
    }).join('') || '<span class="hint">— ไม่มีคอลัมน์เหลือ —</span>';
    box.querySelectorAll('[data-extra]').forEach(inp=>{
      inp.parentElement.onclick = (e)=>{
        e.preventDefault();
        const h = inp.dataset.extra;
        if(S().extraCols.includes(h)) S().extraCols = S().extraCols.filter(x=>x!==h);
        else S().extraCols.push(h);
        renderExtraColsBox();
      };
    });
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.mapping = { renderStep3, renderExtraColsBox };
})();

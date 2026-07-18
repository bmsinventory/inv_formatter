window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function exportFilteredImage(rows){
    if(!rows.length){ SLF.components.toast('ไม่มีข้อมูลตามตัวกรองสำหรับส่งออก','err'); return; }
    const fmtDate = SLF.utils.date.fmtDate;
    const f = S().filters;
    const filterNames = [];
    if(f.search) filterNames.push('คำค้น: '+f.search);
    if(f.onlyMulti) filterNames.push('หลาย LOT');
    if(f.onlyNoLot) filterNames.push('ไม่มี LOT');
    if(f.onlyNearExp) filterNames.push('ใกล้หมดอายุ');
    if(f.onlyExpired) filterNames.push('หมดอายุแล้ว');
    if(f.onlyInvalidExp) filterNames.push('วันหมดอายุไม่ถูกต้อง');

    const columns = [
      {label:'รหัส INV', width:120, value:r=>r.inv_code||'-'},
      {label:'ชื่อรายการ', width:400, value:r=>r.name||'-'},
      {label:'หน่วย', width:100, value:r=>r.unit||'-'},
      {label:'LOT', width:150, value:r=>r.lot||'-'},
      {label:'วันหมดอายุ', width:150, value:r=>r.expDate?fmtDate(r.expDate):(r.expRaw||'-')},
      {label:'คงเหลือ', width:110, value:r=>String(r.qty)},
      {label:'ราคาต่อหน่วย', width:150, value:r=>typeof r.price_unit==='number'?r.price_unit.toFixed(2):(r.price_unit||'-')},
      {label:'ราคารวม', width:160, value:r=>typeof r.price_total==='number'?r.price_total.toFixed(2):(r.price_total||'-')},
      {label:'สถานะ', width:170, value:r=>r.expRaw&&!r.expDate?'วันหมดอายุไม่ถูกต้อง':(r.expDate&&r.expDate<new Date()?'หมดอายุแล้ว':(r.nearExpiry?'ใกล้หมดอายุ':'ปกติ'))},
    ];
    const width = columns.reduce((sum,col)=>sum+col.width,0)+80;
    const rowHeight = 38;
    const headerHeight = 190;
    const height = Math.min(30000,headerHeight+rowHeight*(rows.length+1)+50);
    const maxRows = Math.floor((height-headerHeight-50)/rowHeight)-1;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle='#F4F7F6'; ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#075B4D'; ctx.fillRect(0,0,width,132);
    ctx.fillStyle='#FFFFFF'; ctx.font='600 28px Kanit, sans-serif'; ctx.fillText('รายการสินค้าสำหรับตรวจสอบแก้ไข',40,48);
    ctx.font='16px IBM Plex Sans Thai, sans-serif';
    ctx.fillStyle='rgba(255,255,255,.82)'; ctx.fillText('ตัวกรอง: '+(filterNames.join(' • ')||'ทั้งหมด'),40,80);
    const total = rows.reduce((sum,r)=>sum+(typeof r.price_total==='number'?r.price_total:0),0);
    ctx.fillText(`จำนวน ${rows.length} รายการ  •  มูลค่ารวม ${total.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท`,40,108);
    ctx.textAlign='right'; ctx.fillText('สร้างเมื่อ '+new Date().toLocaleString('th-TH'),width-40,48); ctx.textAlign='left';

    let x=40, y=150;
    ctx.fillStyle='#087F6A'; ctx.fillRect(40,y,width-80,rowHeight);
    ctx.font='600 14px IBM Plex Sans Thai, sans-serif'; ctx.fillStyle='#fff';
    columns.forEach(col=>{ ctx.fillText(col.label,x+9,y+25); x+=col.width; });
    rows.slice(0,maxRows).forEach((row,index)=>{
      y+=rowHeight; x=40;
      ctx.fillStyle=index%2?'#F8FBFA':'#FFFFFF'; ctx.fillRect(40,y,width-80,rowHeight);
      ctx.strokeStyle='#D9E4E1'; ctx.beginPath(); ctx.moveTo(40,y+rowHeight); ctx.lineTo(width-40,y+rowHeight); ctx.stroke();
      ctx.font='14px IBM Plex Sans Thai, sans-serif'; ctx.fillStyle='#122925';
      columns.forEach(col=>{
        let value=String(col.value(row));
        while(value.length>1 && ctx.measureText(value).width>col.width-18) value=value.slice(0,-1);
        if(value!==String(col.value(row))) value+='…';
        ctx.fillText(value,x+9,y+25); x+=col.width;
      });
    });
    canvas.toBlob(blob=>{
      if(!blob){ SLF.components.toast('ไม่สามารถสร้างภาพได้','err'); return; }
      const url=URL.createObjectURL(blob); const a=document.createElement('a');
      a.href=url; a.download='stock-lot-filtered-'+new Date().toISOString().slice(0,10)+'.png'; a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      SLF.components.toast('ส่งออกภาพตามตัวกรองแล้ว','ok');
    },'image/png');
  }

  function renderStep6(c){
    const escapeHtml = SLF.utils.string.escapeHtml;
    const cellDisplay = SLF.utils.date.cellDisplay;
    const fmtDate = SLF.utils.date.fmtDate;
    const parseExpireDate = SLF.utils.date.parseExpireDate;
    const FIELD_DEFS = SLF.config.FIELD_DEFS;
    const FIELD_TO_ROWKEY = SLF.config.FIELD_TO_ROWKEY;
    const PASSTHROUGH_FIELDS = SLF.config.PASSTHROUGH_FIELDS;
    const { computeStats, filteredGrouped } = SLF.core;
    const fmtMoney = value=>new Intl.NumberFormat('th-TH',{
      minimumFractionDigits:2, maximumFractionDigits:2
    }).format(value||0);

    const stats = computeStats();
    const rows = filteredGrouped();
    const selectedFilterCount = ['onlyMulti','onlyNoLot','onlyNearExp','onlyExpired','onlyInvalidExp'].filter(k=>S().filters[k]).length;
    const todayForCounts = new Date(); todayForCounts.setHours(0,0,0,0);
    const filterCounts = {
      onlyMulti:S().grouped.filter(r=>r.lotCountInGroup>1).length,
      onlyNoLot:S().grouped.filter(r=>r.lotEmpty).length,
      onlyNearExp:S().grouped.filter(r=>r.nearExpiry).length,
      onlyExpired:S().grouped.filter(r=>r.expDate&&r.expDate.getTime()<todayForCounts.getTime()).length,
      onlyInvalidExp:S().grouped.filter(r=>r.expRaw&&!r.expDate).length,
    };
    const pageSize = S().pageSize;
    const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
    if(S().page>totalPages) S().page = totalPages;
    const pageRows = rows.slice((S().page-1)*pageSize, S().page*pageSize);

    // all 16 standard columns always appear, in fixed order, regardless of mapping status
    const cols = FIELD_DEFS.map(fd=> ({k: FIELD_TO_ROWKEY[fd.key] || fd.key, label: fd.label}));
    S().extraCols.forEach(h=> cols.push({k:'extra:'+h, label:h}));

    c.innerHTML = `
      <div class="panel preview-panel">
        <h2>6. ดูตัวอย่างผลลัพธ์</h2>
        <p class="sub">ตรวจสอบข้อมูลที่จัดกลุ่มแล้ว สามารถแก้ไขค่าในตารางได้โดยคลิกที่เซลล์</p>
        <div class="preview-total-card">
          <div>
            <div class="preview-total-label">มูลค่ารวมทั้งหมด</div>
            <div class="preview-total-hint">รวมราคาของสินค้าคงเหลือทุก LOT หลังจัดรูปแบบ</div>
          </div>
          <div class="preview-total-value"><span>฿</span>${fmtMoney(stats.totalValue)}</div>
        </div>
        <div class="stat-grid preview-stat-grid">
          <div class="stat-card"><div class="n">${stats.uniqueItems}</div><div class="l">สินค้าไม่ซ้ำ</div></div>
          <div class="stat-card"><div class="n">${stats.originalRows}</div><div class="l">แถวข้อมูลต้นฉบับ</div></div>
          <div class="stat-card"><div class="n">${stats.formattedRows}</div><div class="l">แถวหลังจัดรูปแบบ</div></div>
          <div class="stat-card"><div class="n">${stats.totalLots}</div><div class="l">LOT ทั้งหมด</div></div>
          <div class="stat-card"><div class="n">${stats.withOneLot}</div><div class="l">สินค้าที่มี 1 LOT</div></div>
          <div class="stat-card warn"><div class="n">${stats.withMultiLot}</div><div class="l">สินค้าที่มีมากกว่า 1 LOT</div></div>
          <div class="stat-card"><div class="n">${stats.withNoLot}</div><div class="l">สินค้าที่ไม่มี LOT</div></div>
          <div class="stat-card danger"><div class="n">${stats.nearExp}</div><div class="l">ใกล้หมดอายุ</div></div>
        </div>
        <div class="preview-toolbar">
          <div class="filters">
          <input type="text" id="fSearch" placeholder="ค้นหารหัส INV / รหัสเดิม / ชื่อสินค้า / LOT" value="${escapeHtml(S().filters.search)}">
          <details class="multi-filter" id="filterMenu">
            <summary>ตัวกรอง${selectedFilterCount?` (${selectedFilterCount})`:''}</summary>
            <div class="multi-filter-list">
              <div class="multi-filter-heading"><strong>เลือกสถานะที่ต้องการ</strong><span>เลือกพร้อมกันได้หลายรายการ</span></div>
              <div class="multi-filter-options">
                <label><input type="checkbox" data-filter="onlyMulti" ${S().filters.onlyMulti?'checked':''}><span>หลาย LOT เท่านั้น</span><b>${filterCounts.onlyMulti}</b></label>
                <label><input type="checkbox" data-filter="onlyNoLot" ${S().filters.onlyNoLot?'checked':''}><span>ไม่มี LOT เท่านั้น</span><b>${filterCounts.onlyNoLot}</b></label>
                <label><input type="checkbox" data-filter="onlyNearExp" ${S().filters.onlyNearExp?'checked':''}><span>ใกล้หมดอายุเท่านั้น</span><b>${filterCounts.onlyNearExp}</b></label>
                <label><input type="checkbox" data-filter="onlyExpired" ${S().filters.onlyExpired?'checked':''}><span>หมดอายุแล้ว</span><b>${filterCounts.onlyExpired}</b></label>
                <label><input type="checkbox" data-filter="onlyInvalidExp" ${S().filters.onlyInvalidExp?'checked':''}><span>วันหมดอายุไม่ถูกต้อง</span><b>${filterCounts.onlyInvalidExp}</b></label>
              </div>
              <div class="multi-filter-actions"><button type="button" class="btn btn-sm" id="clearFilters">ล้างทั้งหมด</button><button type="button" class="btn btn-sm btn-primary" id="applyFilters">ใช้ตัวกรอง</button></div>
            </div>
          </details>
          <button class="btn btn-primary btn-export-image" id="btnExportImage">บันทึกภาพ</button>
          </div>
        </div>
        <div class="table-scroll" style="max-height:460px">
          <table class="data" id="previewTable">
            <thead><tr>${cols.map(cc=>`<th>${escapeHtml(cc.label)}</th>`).join('')}</tr></thead>
            <tbody>
              ${pageRows.map(r=>{
                const showMain = S().settings.displayMode==='repeat' || r.isFirstOfGroup;
                const trCls = (r.isFirstOfGroup?'group-start ':'') + (r.lotCountInGroup>1?'multi-lot':'');
                return `<tr class="${trCls}" data-rn="${r.__rowNum}">
                  ${cols.map(cc=>{
                    if(cc.k==='name'){
                      return `<td class="name-cell">${showMain? escapeHtml(r.name) : '<span class="dim">”</span>'}</td>`;
                    }
                    if(cc.k==='code') return `<td>${showMain? escapeHtml(r.code) : ''}</td>`;
                    if(cc.k==='unit') return `<td>${showMain? escapeHtml(r.unit) : ''}</td>`;
                    if(cc.k==='warehouse') return `<td>${escapeHtml(r.warehouse)}</td>`;
                    if(cc.k==='lot') return `<td class="editable mono" contenteditable="true" data-edit="lot">${escapeHtml(r.lot)}</td>`;
                    if(cc.k==='expDate') return `<td class="editable ${r.nearExpiry?'near-exp':''}" contenteditable="true" data-edit="expDate">${r.expDate? fmtDate(r.expDate) : (r.expRaw? escapeHtml(String(r.expRaw)) : '-')}</td>`;
                    if(cc.k==='qty') return `<td class="editable mono" contenteditable="true" data-edit="qty">${r.qty}</td>`;
                    if(cc.k==='price_unit' || cc.k==='price_total') return `<td>${typeof r[cc.k]==='number'? r[cc.k].toFixed(2) : escapeHtml(cellDisplay(r[cc.k]))}</td>`;
                    if(PASSTHROUGH_FIELDS.includes(cc.k)) return `<td>${escapeHtml(cellDisplay(r[cc.k]))}</td>`;
                    if(cc.k.startsWith('extra:')){
                      const h = cc.k.slice(6);
                      return `<td>${showMain? escapeHtml(cellDisplay(r.extra[h])) : ''}</td>`;
                    }
                    return '<td></td>';
                  }).join('')}
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <span>แสดง ${rows.length? ((S().page-1)*pageSize+1):0}-${Math.min(S().page*pageSize, rows.length)} จาก ${rows.length} แถว</span>
          <select id="pageSizeSel">
            ${[25,50,100,200].map(n=>`<option value="${n}" ${pageSize===n?'selected':''}>${n} แถว/หน้า</option>`).join('')}
          </select>
          <button id="prevPage" ${S().page<=1?'disabled':''}>‹ ก่อนหน้า</button>
          <span>หน้า ${S().page} / ${totalPages}</span>
          <button id="nextPage" ${S().page>=totalPages?'disabled':''}>ถัดไป ›</button>
        </div>
      </div>
    `;

    document.getElementById('fSearch').oninput = (e)=>{ S().filters.search = e.target.value; S().page=1; renderStep6(c); };
    document.getElementById('applyFilters').onclick = ()=>{
      c.querySelectorAll('input[data-filter]').forEach(input=>{ S().filters[input.dataset.filter]=input.checked; });
      S().page=1; renderStep6(c);
    };
    document.getElementById('clearFilters').onclick = ()=>{
      ['onlyMulti','onlyNoLot','onlyNearExp','onlyExpired','onlyInvalidExp'].forEach(k=>{ S().filters[k]=false; });
      S().page=1; renderStep6(c);
    };
    document.getElementById('btnExportImage').onclick = ()=>exportFilteredImage(rows);
    document.getElementById('pageSizeSel').onchange = (e)=>{ S().pageSize = parseInt(e.target.value,10); S().page=1; renderStep6(c); };
    document.getElementById('prevPage').onclick = ()=>{ if(S().page>1){ S().page--; renderStep6(c); } };
    document.getElementById('nextPage').onclick = ()=>{ if(S().page<totalPages){ S().page++; renderStep6(c); } };

    c.querySelectorAll('td.editable').forEach(td=>{
      td.addEventListener('blur', ()=>{
        const rn = parseInt(td.closest('tr').dataset.rn,10);
        const field = td.dataset.edit;
        const row = S().grouped.find(r=>r.__rowNum===rn);
        if(!row) return;
        const val = td.textContent.trim();
        if(field==='qty'){
          const oldQty = row.qty;
          const oldTotal = row.price_total;
          const n = parseFloat(val.replace(/,/g,''));
          row.qty = isNaN(n)?0:n;
          row.qtyValid=!isNaN(n);
          // Keep the source price basis intact and refresh the summary total after edits.
          if(typeof oldTotal==='number' && typeof oldQty==='number' && oldQty!==0){
            row.price_total = row.qty * (oldTotal/oldQty);
          }
        }
        else if(field==='lot'){ row.lot = val; row.lotEmpty = !val; }
        else if(field==='expDate'){ const d = parseExpireDate(val); row.expDate = d; row.expRaw = val; }
        SLF.components.toast('บันทึกการแก้ไขแล้ว','ok');
        if(field==='qty') renderStep6(c);
      });
    });
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.preview = { renderStep6 };
})();

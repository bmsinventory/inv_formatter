window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  async function doExport(){
    const FIELD_DEFS = SLF.config.FIELD_DEFS;
    const FIELD_TO_ROWKEY = SLF.config.FIELD_TO_ROWKEY;
    const FIELD_EXPORT_WIDTH = SLF.config.FIELD_EXPORT_WIDTH;
    const FIELD_TECH_NAME = SLF.config.FIELD_TECH_NAME;

    SLF.components.showLoading('กำลังสร้างไฟล์ Excel...');
    try{
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('StockLotFormatted');

      // all 16 standard columns always appear, in fixed order, regardless of mapping status
      // (no `header` here — the two header rows below are written in manually)
      const cols = FIELD_DEFS.map(fd=> ({
        key: FIELD_TO_ROWKEY[fd.key] || fd.key,
        width: FIELD_EXPORT_WIDTH[fd.key] || 16,
      }));
      S().extraCols.forEach(h=> cols.push({key:'extra_'+h, width:16}));
      ws.columns = cols;

      // row 1: fixed technical field names · row 2: Thai display labels · data starts row 3
      ws.addRow(FIELD_DEFS.map(fd=> FIELD_TECH_NAME[fd.key] || fd.key).concat(S().extraCols));
      ws.addRow(FIELD_DEFS.map(fd=> fd.label).concat(S().extraCols));

      [1,2].forEach(rn=>{
        ws.getRow(rn).eachCell(cell=>{
          cell.font = {bold:true, color:{argb:'FFFFFFFF'}};
          cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF2F6F5E'}};
          cell.alignment = {vertical:'middle', horizontal:'left'};
          cell.border = {bottom:{style:'thin', color:{argb:'FF1E4E42'}}};
        });
      });
      ws.views = [{state:'frozen', ySplit:2}];

      const thin = {style:'thin', color:{argb:'FFDCE2DC'}};
      const multiFill = {type:'pattern', pattern:'solid', fgColor:{argb:'FFF6E4CC'}};

      S().grouped.forEach(r=>{
        const showMain = S().settings.displayMode==='repeat' || r.isFirstOfGroup;
        const rowObj = {
          id: r.id, // รันอัตโนมัติ
          warehouse: r.warehouse, // ระบุเป็นตัวเลขเอง — ค่าเดียวกันทุกแถว
          company_code: r.company_code, // ระบุเป็นตัวเลขเอง — ค่าเดียวกันทุกแถว
          code: showMain? r.code : '',
          inv_code: r.inv_code,
          name: showMain? r.name : '',
          unit: showMain? r.unit : '',
          pack_size: r.pack_size,
          lot: r.lot,
          expDate: r.expDate ? r.expDate : (r.expRaw || '-'),
          qty: r.qty,
          price_unit: r.price_unit,
          price_total: r.price_total, // ราคาต่อหน่วย x คงเหลือ
          import_status: '', // ว่างเสมอ
          donation_receipt_id: '', // ว่างเสมอ
          donation_item_id: '', // ว่างเสมอ
        };
        S().extraCols.forEach(h=> rowObj['extra_'+h] = showMain? r.extra[h] : '');
        const excelRow = ws.addRow(rowObj);

        excelRow.eachCell(cell=>{ cell.border = {top:thin,left:thin,right:thin,bottom:thin}; });
        const qtyCell = excelRow.getCell('qty');
        qtyCell.numFmt = '#,##0';
        if(typeof r.price_unit==='number'){
          excelRow.getCell('price_unit').numFmt = '0.00';
        }
        if(typeof r.price_total==='number'){
          excelRow.getCell('price_total').numFmt = '0.00';
        }
        if(r.expDate) excelRow.getCell('expDate').numFmt = 'dd/mm/yyyy';
        if(r.lotCountInGroup>1){
          excelRow.eachCell(cell=>{ if(!cell.fill || cell.fill.fgColor.argb!=='FF2F6F5E') cell.fill = multiFill; });
        }
        if(r.nearExpiry){
          const c3 = excelRow.getCell('expDate');
          c3.font = {color:{argb:'FFB3432B'}, bold:true};
        }
      });

      ws.autoFilter = { from:{row:2,column:1}, to:{row:2,column:cols.length} };

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {type:'application/octet-stream'});
      const now = new Date();
      const pad = n=>String(n).padStart(2,'0');
      const fname = `Stock_Lot_Formatted_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      SLF.components.hideLoading();
      document.getElementById('exportStatus').textContent = `ดาวน์โหลดไฟล์ "${fname}" สำเร็จ`;
      SLF.components.toast('ส่งออกไฟล์สำเร็จ','ok');
    }catch(err){
      SLF.components.hideLoading();
      SLF.components.toast('เกิดข้อผิดพลาดขณะสร้างไฟล์: '+err.message,'err');
    }
  }

  SLF.services = SLF.services || {};
  SLF.services.excelExport = { doExport };
})();

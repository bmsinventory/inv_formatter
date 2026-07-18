window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function runValidation(){
    const { pairMultiFieldsByBlock } = SLF.utils.mapping;
    const { parseQty } = SLF.utils.number;
    const { parseExpireDate } = SLF.utils.date;

    const issues = [];
    const map = S().mapping;
    const codeSeenName = {}; // old_code -> first name seen
    const itemLotSeen = {}; // itemKey|lot -> count
    const rowHasAnyStock = {}; // rowNum -> true if ANY lot-block in this row has valid qty>0

    const pairs = pairMultiFieldsByBlock(map);
    const setCount = Math.max(pairs.length, 1);

    S().dataRows.forEach(row=>{
      const rn = row.__rowNum;
      const code = map.old_code ? String(row[map.old_code]||'').trim() : '';
      const name = map.item_name ? String(row[map.item_name]||'').trim() : '';

      if(map.old_code && !code) issues.push({rowNum:rn, field:'old_code', type:'empty_code', message:'รหัสเดิมว่าง', severity:'warning'});
      if(map.item_name && !name) issues.push({rowNum:rn, field:'item_name', type:'empty_name', message:'ชื่อสินค้าว่าง', severity:'error'});

      if(map.old_code && code){
        if(codeSeenName[code]===undefined) codeSeenName[code]=name;
        else if(codeSeenName[code] !== name && name) issues.push({rowNum:rn, field:'item_name', type:'code_name_mismatch', message:'รหัสเดิมเดียวกันแต่ชื่อไม่ตรงกับแถวก่อนหน้า', severity:'warning'});
      }

      const unitForKey = map.unit ? String(row[map.unit]||'').trim() : '';
      const itemKey = code || (name+'|'+unitForKey);

      pairs.forEach((pair,i)=>{
        const lotHeader = pair.lotHeader;
        const expHeader = pair.expHeader;
        const qtyHeader = pair.qtyHeader;

        const lot = lotHeader ? String(row[lotHeader]||'').trim() : '';
        const qtyRaw = qtyHeader ? row[qtyHeader] : '';
        const qty = qtyHeader ? parseQty(qtyRaw) : NaN;
        const expRaw = expHeader ? row[expHeader] : '';
        // an item usually doesn't fill every mapped lot slot — a fully blank set just means
        // "this slot unused for this row", not a data problem, so skip it silently
        if(!lot && String(qtyRaw||'').trim()==='' && String(expRaw||'').trim()==='') return;

        const tag = setCount>1 ? ` (ชุดที่ ${i+1})` : '';

        if(lotHeader && !lot) issues.push({rowNum:rn, field:'lot', type:'empty_lot', message:'LOT ว่าง'+tag+' (จะแสดงเป็น "'+S().settings.noLotLabel+'")', severity:'info'});
        if(qtyHeader){
          if(qtyRaw==='' || isNaN(qty)) issues.push({rowNum:rn, field:'qty', type:'qty_nan', message:'จำนวนคงเหลือไม่ใช่ตัวเลข'+tag, severity:'error'});
          else if(qty<0) issues.push({rowNum:rn, field:'qty', type:'qty_neg', message:'จำนวนคงเหลือติดลบ'+tag, severity:'warning'});
          else if(qty===0) issues.push({rowNum:rn, field:'qty', type:'no_stock', message:'คงเหลือ=0'+tag+' (จะไม่แสดงในผลลัพธ์)', severity:'info'});
          else rowHasAnyStock[rn] = true;
        }
        if(expHeader && expRaw && !parseExpireDate(expRaw)) issues.push({rowNum:rn, field:'expire', type:'exp_bad', message:'รูปแบบวันหมดอายุผิดพลาด'+tag+' (จะแสดงเป็น "-")', severity:'warning'});

        if(lotHeader && lot){
          // key includes unit: the same LOT commonly appears twice for one item (once in loose units,
          // once in boxes) — that's a normal unit-conversion pattern, not a duplicate-entry error.
          const k = itemKey+'|'+lot+'|'+unitForKey;
          itemLotSeen[k] = (itemLotSeen[k]||0)+1;
          if(itemLotSeen[k]>1) issues.push({rowNum:rn, field:'lot', type:'dup_lot', message:'LOT และหน่วยนับซ้ำในสินค้าเดียวกัน'+tag+(S().settings.mergeDuplicateLot?' (จะถูกรวมจำนวนอัตโนมัติ)':''), severity: S().settings.mergeDuplicateLot?'info':'warning'});
        }
      });
    });

    S().issues = issues;
    // set default resolutions: error -> skip, others -> keep (unless already set by user)
    const rowHasError = {};
    issues.forEach(is=>{ if(is.severity==='error') rowHasError[is.rowNum]=true; });
    S().dataRows.forEach(row=>{
      if(S().rowResolution[row.__rowNum]===undefined){
        const rn = row.__rowNum;
        // a row with several Lot/Exp/Qty column-sets often has a bad or stray value in ONE unused
        // slot (e.g. a leftover Exp with no matching Lot/Qty) while another slot has real stock —
        // don't let that one bad slot auto-skip the whole row and hide the valid stock elsewhere;
        // computeGrouped already filters out individual empty/invalid slots on its own.
        const shouldSkip = rowHasError[rn] && !rowHasAnyStock[rn];
        S().rowResolution[rn] = shouldSkip ? 'skip' : 'keep';
        if(rowHasError[rn]){
          S().rowResolutionReason[rn] = shouldSkip
            ? 'ระบบข้ามอัตโนมัติ เพราะไม่พบข้อมูล LOT ที่มีจำนวนคงเหลือถูกต้องในแถวนี้'
            : 'ไม่ข้าม เพราะยังพบข้อมูล LOT ชุดอื่นในแถวเดียวกันที่มีจำนวนคงเหลือถูกต้อง';
        }
      }
    });
  }

  SLF.core = SLF.core || {};
  SLF.core.runValidation = runValidation;
})();

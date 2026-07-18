window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function computeGrouped(){
    const { manualNum, parseQty } = SLF.utils.number;
    const { pairMultiFieldsByBlock } = SLF.utils.mapping;
    const { parseExpireDate } = SLF.utils.date;

    const map = S().mapping;
    const kept = S().dataRows.filter(row=> S().rowResolution[row.__rowNum] !== 'skip');

    // build item groups preserving first-appearance order
    const groupsOrder = [];
    const groupsMap = {};
    const wh = manualNum(map.warehouse); // manual, single value applied to the whole export

    kept.forEach(row=>{
      const code = map.old_code ? String(row[map.old_code]||'').trim() : '';
      const name = map.item_name ? String(row[map.item_name]||'').trim() : '';
      const unit = map.unit ? String(row[map.unit]||'').trim() : '';
      const itemKey = code || (name+'|'+unit);

      if(!groupsMap[itemKey]){
        groupsMap[itemKey] = { itemKey, code, name, unit, warehouse:wh, rows:[] };
        groupsOrder.push(itemKey);
      }
      groupsMap[itemKey].rows.push(row);
    });

    // Lot./Exp./คงเหลือ can each be mapped to several source columns (e.g. Lot1/Exp1/Qty1, Lot2/Exp2/Qty2 …);
    // pair them up by their disambiguated block number, not by array position.
    const pairs = pairMultiFieldsByBlock(map);

    // within each group: optionally merge duplicate lots, then sort
    const finalRows = [];
    let idCounter = 0; // ID = รันอัตโนมัติ ตามลำดับแถวในผลลัพธ์สุดท้าย
    groupsOrder.forEach(key=>{
      const g = groupsMap[key];
      let lotRows = [];
      g.rows.forEach(row=>{
        pairs.forEach(pair=>{
          const lotHeader = pair.lotHeader;
          const expHeader = pair.expHeader;
          const qtyHeader = pair.qtyHeader;

          const lot = lotHeader ? String(row[lotHeader]||'').trim() : '';
          const expRaw = expHeader ? row[expHeader] : '';
          const qtyRaw = qtyHeader ? row[qtyHeader] : '';

          const expDate = expHeader ? parseExpireDate(expRaw) : null;
          const qtyParsed = qtyHeader ? parseQty(qtyRaw) : NaN;
          const qty = isNaN(qtyParsed) ? 0 : qtyParsed;
          // only lot-blocks with remaining stock make it into the output — a slot with a stale
          // Lot/Exp reference but no (or zero, or invalid) คงเหลือ is treated as unused, not shown
          if(qty<=0) return;

          // ราคาต่อหน่วย: ถ้าขนาดบรรจุ > 1 ให้ปรับเป็นราคาต่อหน่วยย่อย (ราคาต่อหน่วยดิบ / ขนาดบรรจุ)
          // มิฉะนั้นแสดงราคาต่อหน่วยดิบตามไฟล์ — ราคารวม = คงเหลือ x ราคาต่อหน่วยดิบตามไฟล์ (ไม่ปรับตามขนาดบรรจุ)
          const packRaw = map.pack_size ? row[map.pack_size] : '';
          const packNum = parseQty(packRaw);
          const puRaw = map.price_unit ? row[map.price_unit] : '';
          const puRawNum = parseQty(puRaw);
          let priceUnitOut = puRaw;
          let priceTotalOut = '';
          if(!isNaN(puRawNum)){
            priceUnitOut = (!isNaN(packNum) && packNum>1) ? (puRawNum/packNum) : puRawNum;
            priceTotalOut = qty * puRawNum;
          }

          const passthrough = {
            company_code: manualNum(map.company_code), // manual, same value on every row
            inv_code: map.inv_code ? row[map.inv_code] : '',
            pack_size: packRaw,
            price_unit: priceUnitOut,
            price_total: priceTotalOut,
            import_status: '', donation_receipt_id: '', donation_item_id: '', // always blank
          };

          lotRows.push({
            __rowNum: row.__rowNum,
            code: g.code, name: g.name, unit: g.unit, warehouse: g.warehouse,
            lot: lot || S().settings.noLotLabel,
            lotEmpty: !lot,
            expDate, expRaw,
            qty,
            qtyValid: !isNaN(qtyParsed),
            ...passthrough,
            extra: Object.fromEntries(S().extraCols.map(h=>[h, row[h]])),
          });
        });
      });

      if(S().settings.mergeDuplicateLot){
        const merged = {};
        const order = [];
        lotRows.forEach(r=>{
          const k = r.lot;
          if(!merged[k]){ merged[k] = {...r}; order.push(k); }
          else {
            merged[k].qty += r.qty;
            if(typeof merged[k].price_total==='number' && typeof r.price_total==='number') merged[k].price_total += r.price_total;
          }
        });
        lotRows = order.map(k=>merged[k]);
      }

      // sort (source_order = leave as built, i.e. original file order)
      const sortFn = {
        lot_asc: (a,b)=> String(a.lot).localeCompare(String(b.lot), 'th', {numeric:true}),
        expire_asc: (a,b)=> (a.expDate?a.expDate.getTime():Infinity) - (b.expDate?b.expDate.getTime():Infinity),
        expire_desc: (a,b)=> (b.expDate?b.expDate.getTime():-Infinity) - (a.expDate?a.expDate.getTime():-Infinity),
        qty_desc: (a,b)=> b.qty - a.qty,
      }[S().settings.lotSort];
      if(sortFn) lotRows.sort(sortFn);

      lotRows.forEach((r,i)=>{
        const now = new Date();
        const warnMs = S().settings.expiryWarnDays*24*3600*1000;
        const expiryDiff = r.expDate ? r.expDate.getTime()-now.getTime() : null;
        const nearExpiry = expiryDiff!==null && expiryDiff>=0 && expiryDiff<=warnMs;
        idCounter++;
        finalRows.push({
          ...r,
          id: idCounter,
          isFirstOfGroup: i===0,
          lotCountInGroup: lotRows.length,
          nearExpiry,
        });
      });
    });

    S().grouped = finalRows;
    S().page = 1;
  }

  function computeStats(){
    const items = {};
    S().grouped.forEach(r=>{ (items[r.code+'|'+r.name] = items[r.code+'|'+r.name]||[]).push(r); });
    const itemList = Object.values(items);
    const withOneLot = itemList.filter(g=>g.length===1).length;
    const withMultiLot = itemList.filter(g=>g.length>1).length;
    const withNoLot = S().grouped.filter(r=>r.lotEmpty).length;
    const nearExp = S().grouped.filter(r=>r.nearExpiry).length;
    const totalValue = S().grouped.reduce((sum,r)=>{
      const value = typeof r.price_total==='number' ? r.price_total : Number(r.price_total);
      return sum + (Number.isFinite(value) ? value : 0);
    },0);
    return {
      uniqueItems: itemList.length,
      originalRows: S().dataRows.length,
      formattedRows: S().grouped.length,
      totalLots: S().grouped.length,
      withOneLot, withMultiLot, withNoLot, nearExp, totalValue,
      errorCount: S().issues.filter(i=>i.severity==='error').length,
    };
  }

  function filteredGrouped(){
    let rows = S().grouped;
    const f = S().filters;
    if(f.search){
      const q = f.search.toLowerCase();
      rows = rows.filter(r=> String(r.inv_code||'').toLowerCase().includes(q) || String(r.code||'').toLowerCase().includes(q) || String(r.name||'').toLowerCase().includes(q) || String(r.lot||'').toLowerCase().includes(q));
    }
    const activeFilters = [];
    const today = new Date(); today.setHours(0,0,0,0);
    if(f.onlyMulti) activeFilters.push(r=>r.lotCountInGroup>1);
    if(f.onlyNoLot) activeFilters.push(r=>r.lotEmpty);
    if(f.onlyNearExp) activeFilters.push(r=>r.nearExpiry);
    if(f.onlyExpired) activeFilters.push(r=>r.expDate && r.expDate.getTime()<today.getTime());
    if(f.onlyInvalidExp) activeFilters.push(r=>r.expRaw && !r.expDate);
    if(activeFilters.length) rows = rows.filter(r=>activeFilters.some(matches=>matches(r)));
    return rows;
  }

  SLF.core = SLF.core || {};
  SLF.core.computeGrouped = computeGrouped;
  SLF.core.computeStats = computeStats;
  SLF.core.filteredGrouped = filteredGrouped;
})();

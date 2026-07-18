window.SLF = window.SLF || {};

(function(){
  const MULTI_FIELDS = SLF.config.MULTI_FIELDS;
  const FIELD_DEFS = SLF.config.FIELD_DEFS;

  // duplicate headers get disambiguated as "Lot", "Lot (2)", "Lot (3)", … (see excel-import.service's
  // applyHeaderRow). That trailing "(N)" is the reliable signal for which lot-block a column belongs
  // to — pairing Lot/Exp/คงเหลือ columns by array position instead breaks as soon as one block's
  // columns aren't in the same relative order as another's, so we pair by this block number instead.
  function blockNumberOf(header){
    const m = String(header).match(/\s\((\d+)\)$/);
    return m ? parseInt(m[1],10) : 1;
  }

  // returns [{lotHeader, expHeader, qtyHeader}, …] sorted by block number, one entry per block that
  // has at least one of lot/expire/qty mapped to it
  function pairMultiFieldsByBlock(map){
    const byBlock = {lot:{}, expire:{}, qty:{}};
    MULTI_FIELDS.forEach(k=> map[k].forEach(h=> byBlock[k][blockNumberOf(h)] = h));
    const blocks = new Set([...Object.keys(byBlock.lot), ...Object.keys(byBlock.expire), ...Object.keys(byBlock.qty)]);
    return [...blocks].map(Number).sort((a,b)=>a-b).map(bn=> ({
      lotHeader: byBlock.lot[bn], expHeader: byBlock.expire[bn], qtyHeader: byBlock.qty[bn],
    }));
  }

  function mappedHeaders(map){
    const out = [];
    FIELD_DEFS.forEach(fd=>{
      if(fd.kind!=='file') return; // 'manual' values are literal numbers, not header names
      const v = map[fd.key];
      if(Array.isArray(v)) out.push(...v);
      else if(v) out.push(v);
    });
    return out;
  }

  SLF.utils = SLF.utils || {};
  SLF.utils.mapping = { blockNumberOf, pairMultiFieldsByBlock, mappedHeaders };
})();

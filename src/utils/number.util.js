window.SLF = window.SLF || {};

(function(){
  function parseQty(v){
    if(v===''||v===undefined||v===null) return NaN;
    const n = parseFloat(String(v).replace(/,/g,''));
    return n;
  }

  function manualNum(v){
    // manual fields (รหัสคลัง/รหัสบริษัท) come from <input type=number>, so a numeric-looking
    // string should land in Excel as an actual number, not text
    if(v===''||v===undefined||v===null) return '';
    const n = Number(v);
    return isNaN(n) ? v : n;
  }

  SLF.utils = SLF.utils || {};
  SLF.utils.number = { parseQty, manualNum };
})();

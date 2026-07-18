window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  function renderStepper(){
    const STEP_LABELS = SLF.config.STEP_LABELS;
    const el = document.getElementById('stepper');
    el.innerHTML = STEP_LABELS.map((label,i)=>{
      const n = i+1;
      const cls = n===S().step ? 'active' : (n<S().step ? 'done' : '');
      return `<div class="step ${cls}" data-step="${n}">
        <div class="cap">${n<S().step ? '✓' : n}</div>
        <div class="step-label">${label}</div>
      </div>`;
    }).join('');
    el.querySelectorAll('.step').forEach(stepEl=>{
      stepEl.style.cursor='pointer';
      stepEl.onclick = ()=>{
        const n = parseInt(stepEl.dataset.step,10);
        if(n < S().step || canAdvanceTo(n)) { S().step = n; SLF.router.render(); }
      };
    });
  }

  function canAdvanceTo(n){
    // only allow jumping forward if all prior steps satisfied
    for(let i=1;i<n;i++){ if(!stepIsValid(i)) return false; }
    return true;
  }

  function stepIsValid(n){
    switch(n){
      case 1: return !!S().workbook;
      case 2: return !!S().selectedSheet && S().headers.length>0 && S().sheetRawRows.length > S().headerRowIndex+1;
      case 3: return !!S().mapping.item_name && S().mapping.qty.length>0;
      case 4: return true;
      case 5: return true;
      case 6: return true;
      case 7: return true;
      default: return true;
    }
  }

  function renderFooter(){
    const back = document.getElementById('btnBack');
    const next = document.getElementById('btnNext');
    back.style.visibility = S().step===1 ? 'hidden' : 'visible';
    next.textContent = S().step===7 ? 'เสร็จสิ้น' : 'ถัดไป →';
    next.disabled = !stepIsValid(S().step);
  }

  SLF.components = SLF.components || {};
  SLF.components.stepper = { renderStepper, renderFooter, canAdvanceTo, stepIsValid };
})();

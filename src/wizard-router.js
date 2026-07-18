window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  // dispatches on the wizard's own step number (1-7) — there are no real URLs/pages here,
  // this just decides which step module renders into #stepContent
  function render(){
    SLF.components.stepper.renderStepper();
    SLF.components.stepper.renderFooter();
    const c = document.getElementById('stepContent');
    c.innerHTML='';
    switch(S().step){
      case 1: SLF.pages.upload.renderStep1(c); break;
      case 2: SLF.pages.sheetSelect.renderStep2(c); break;
      case 3: SLF.pages.mapping.renderStep3(c); break;
      case 4: SLF.pages.settings.renderStep4(c); break;
      case 5: SLF.pages.validation.renderStep5(c); break;
      case 6: SLF.pages.preview.renderStep6(c); break;
      case 7: SLF.pages.exportPage.renderStep7(c); break;
    }
  }

  SLF.router = { render };
})();

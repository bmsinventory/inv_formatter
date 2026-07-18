window.SLF = window.SLF || {};

(function(){
  function S(){ return SLF.state.S; }

  document.getElementById('btnBack').onclick = ()=>{ if(S().step>1){ S().step--; SLF.router.render(); } };

  document.getElementById('btnNext').onclick = ()=>{
    const { stepIsValid } = SLF.components.stepper;
    if(!stepIsValid(S().step)){ SLF.components.toast('กรุณากรอกข้อมูลที่จำเป็นให้ครบก่อน','err'); return; }
    if(S().step===2){ SLF.services.excelImport.buildDataRows(); }
    if(S().step===3){ /* nothing extra */ }
    if(S().step===4){ SLF.core.runValidation(); }
    if(S().step===5){ SLF.core.computeGrouped(); }
    if(S().step<7){ S().step++; SLF.router.render(); }
    else { SLF.components.toast('พร้อมส่งออกไฟล์แล้ว','ok'); }
  };

  document.getElementById('btnReset').onclick = ()=>{
    SLF.components.confirmModal('ล้างข้อมูลทั้งหมด?','การเริ่มใหม่จะลบไฟล์และการตั้งค่าทั้งหมดที่ทำไว้ ไม่สามารถย้อนกลับได้', ()=>{
      SLF.state.S = SLF.state.freshState();
      SLF.router.render();
      SLF.components.toast('เริ่มต้นใหม่แล้ว','ok');
    }, 'เริ่มใหม่');
  };

  SLF.router.render();
})();

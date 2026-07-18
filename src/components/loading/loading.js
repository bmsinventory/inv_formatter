window.SLF = window.SLF || {};

(function(){
  function showLoading(msg){
    hideLoading();
    const d = document.createElement('div');
    d.className='loading-overlay'; d.id='loadingOverlay';
    d.innerHTML = '<div class="spinner"></div><div style="font-size:13.5px;color:var(--ink-soft)">'+ (msg||'กำลังประมวลผล...') +'</div>';
    document.body.appendChild(d);
  }
  function hideLoading(){ const e=document.getElementById('loadingOverlay'); if(e) e.remove(); }

  SLF.components = SLF.components || {};
  SLF.components.showLoading = showLoading;
  SLF.components.hideLoading = hideLoading;
})();

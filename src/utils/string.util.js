window.SLF = window.SLF || {};

(function(){
  function normalize(str){
    return (str===undefined||str===null? '' : String(str)).trim().toLowerCase().replace(/[\s_\-\.]/g,'');
  }

  function escapeHtml(v){
    if(v===undefined||v===null) return '';
    return String(v).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  SLF.utils = SLF.utils || {};
  SLF.utils.string = { normalize, escapeHtml };
})();

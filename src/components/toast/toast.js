window.SLF = window.SLF || {};

(function(){
  function toast(msg, type){
    const el = document.createElement('div');
    el.className = 'toast' + (type==='err'?' err':type==='ok'?' ok':'');
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(()=>el.remove(), 3600);
  }

  SLF.components = SLF.components || {};
  SLF.components.toast = toast;
})();

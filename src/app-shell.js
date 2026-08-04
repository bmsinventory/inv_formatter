window.SLF = window.SLF || {};

(function(){
  const THEMES = ['neon','ocean','sunset','light'];
  // top-level menu switcher — separate from wizard-router, which only
  // handles step navigation *within* the lot-formatter module
  const MODULES = {
    'lot-formatter': {
      title: 'Stock Lot Formatter',
      subtitle: 'จัดรูปแบบไฟล์สต็อกตามรายการสินค้าและ LOT — ห้องจ่ายยา',
      showReset: true,
    },
    'stock-count': {
      title: 'Mobile Stock Count',
      subtitle: 'เดินนับยาในห้องจ่ายยาด้วยมือถือหรือ iPad — รองรับหลาย Package, LOT และ EXP',
      showReset: false,
    },
    'duplicate-check': {
      title: 'Duplicate Data Review',
      subtitle: 'ระบบช่วยเสนอรายการวัสดุ สินค้า ยา หรือครุภัณฑ์ที่อาจเป็นรายการเดียวกัน — ผู้ใช้เป็นผู้ตัดสินใจ',
      showReset: false,
    },
  };

  function setActiveModule(mod){
    if(!MODULES[mod]) return;

    document.querySelectorAll('.app-nav-item').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.module===mod);
    });
    document.querySelectorAll('[data-module-panel]').forEach(panel=>{
      panel.hidden = panel.dataset.modulePanel !== mod;
    });

    const cfg = MODULES[mod];
    document.getElementById('moduleTitle').textContent = cfg.title;
    document.getElementById('moduleSubtitle').textContent = cfg.subtitle;
    document.getElementById('btnReset').style.display = cfg.showReset ? '' : 'none';

    const stockCountRoot = document.getElementById('stockCountRoot');
    if(mod==='stock-count' && !stockCountRoot.dataset.rendered){
      SLF.pages.stockCount.render(stockCountRoot);
      stockCountRoot.dataset.rendered = '1';
    }
    const duplicateCheckRoot = document.getElementById('duplicateCheckRoot');
    if(mod==='duplicate-check' && !duplicateCheckRoot.dataset.rendered){
      SLF.pages.duplicateCheck.render(duplicateCheckRoot);
      duplicateCheckRoot.dataset.rendered = '1';
    }
  }

  document.querySelectorAll('.app-nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=> setActiveModule(btn.dataset.module));
  });

  function setTheme(theme){
    const selected = THEMES.includes(theme) ? theme : 'neon';
    document.documentElement.dataset.theme = selected;
    const picker = document.getElementById('themeSelect');
    if(picker) picker.value = selected;
    try{ localStorage.setItem('bms-theme',selected); }catch(e){}
  }

  const themeSelect = document.getElementById('themeSelect');
  if(themeSelect){
    themeSelect.addEventListener('change', e=>setTheme(e.target.value));
    setTheme(document.documentElement.dataset.theme);
  }

  SLF.appShell = { setActiveModule, setTheme };
  setActiveModule('lot-formatter');
})();

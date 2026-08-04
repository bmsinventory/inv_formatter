window.SLF = window.SLF || {};

(function(){
  const THEMES = ['neon','ocean','sunset','light'];
  const app=document.getElementById('app');
  const authRoot=document.getElementById('globalAuthRoot');
  const accountRoot=document.getElementById('appAccount');
  let shellStarted=false;
  // top-level menu switcher — separate from wizard-router, which only
  // handles step navigation *within* the lot-formatter module
  const MODULES = {
    'dashboard': {
      title: 'Stock Count Dashboard',
      subtitle: 'สรุปความคืบหน้า จำนวน และมูลค่าการนับตามขอบเขตสิทธิ์ของผู้ใช้งาน',
      showReset: false,
    },
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
    'super-admin': {
      title: 'Master Data Administration',
      subtitle: 'จัดการโรงพยาบาล หน่วยงาน รายการสินค้า หน่วยบรรจุ และสิทธิ์ผู้ใช้งานทุกองค์กร',
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
    const dashboardRoot = document.getElementById('dashboardRoot');
    if(mod==='dashboard' && !dashboardRoot.dataset.rendered){
      SLF.pages.dashboard.render(dashboardRoot);
      dashboardRoot.dataset.rendered = '1';
    }
    const duplicateCheckRoot = document.getElementById('duplicateCheckRoot');
    if(mod==='duplicate-check' && !duplicateCheckRoot.dataset.rendered){
      SLF.pages.duplicateCheck.render(duplicateCheckRoot);
      duplicateCheckRoot.dataset.rendered = '1';
    }
    const superAdminRoot = document.getElementById('superAdminRoot');
    if(mod==='super-admin' && !superAdminRoot.dataset.rendered){
      SLF.pages.superAdmin.render(superAdminRoot);
      superAdminRoot.dataset.rendered = '1';
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

  function renderGlobalLogin(message){
    app.hidden=true;
    authRoot.innerHTML=`<section class="sc-auth-page global-auth-page">
      <div class="global-auth-shell">
        <section class="global-auth-showcase">
          <div class="global-auth-brand"><div class="brand-mark"></div><strong>BMS Inventory</strong></div>
          <div class="global-auth-copy"><span class="global-auth-eyebrow"><i></i> Inventory workspace</span><h1>จัดการสต็อก<br><em>ง่ายขึ้นในที่เดียว</em></h1><p>ระบบนับและบริหารข้อมูลคลังสำหรับโรงพยาบาล ออกแบบให้ทำงานได้รวดเร็ว แม่นยำ และแยกข้อมูลตามหน่วยงานอย่างชัดเจน</p></div>
          <div class="global-auth-features"><div><span>01</span><strong>นับสต็อก</strong><small>รองรับ Package, LOT และ EXP</small></div><div><span>02</span><strong>ติดตามมูลค่า</strong><small>สรุปยอดตามสาขาและหน่วยงาน</small></div><div><span>03</span><strong>จัดการเป็นระบบ</strong><small>สิทธิ์ผู้ใช้และข้อมูลพื้นฐานครบถ้วน</small></div></div>
          <small class="global-auth-version">BMS Inventory · Secure workspace</small>
        </section>
        <article class="sc-auth-card global-auth-card">
          <div class="global-auth-card-icon"><span></span></div><span class="global-auth-welcome">ยินดีต้อนรับกลับ</span><h2>เข้าสู่ระบบ</h2><p>ใช้บัญชี Google ขององค์กรเพื่อเข้าสู่พื้นที่ทำงานของคุณ</p>
          <button class="sc-google-account" id="globalGoogleLogin"><span class="google-logo">G</span><span><strong>ดำเนินการต่อด้วย Google</strong><small>เข้าสู่ระบบอย่างปลอดภัย</small></span><span class="login-arrow">→</span></button>
          ${message?`<div class="sc-auth-error" role="alert">${safeText(message)}</div>`:''}
          <div class="global-auth-divider"><span>บัญชีของคุณจะถูกตรวจสอบสิทธิ์อัตโนมัติ</span></div><small class="sc-auth-note"><span>✓</span> ระบบจะจดจำการเข้าสู่ระบบบนอุปกรณ์นี้</small>
        </article>
      </div>
    </section>`;
    authRoot.querySelector('#globalGoogleLogin').onclick=async()=>{const button=authRoot.querySelector('#globalGoogleLogin');button.disabled=true;button.classList.add('is-loading');button.querySelector('strong').textContent='กำลังเชื่อมต่อกับ Google...';try{await SLF.auth.googleOAuth();}catch(error){renderGlobalLogin('ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบการตั้งค่า Google และ Supabase');}};
  }

  function showAuthenticatedApp(){
    authRoot.innerHTML='';app.hidden=false;
    SLF.auth.dashboardData().catch(()=>{});
    if(!shellStarted){shellStarted=true;const firstModule=document.querySelector('.app-nav-item:not([hidden])')?.dataset.module;if(firstModule)setActiveModule(firstModule);}
    SLF.auth.superAdminStatus().then(isSuperAdmin=>{const nav=document.querySelector('[data-module="super-admin"]');if(nav)nav.hidden=!isSuperAdmin;if(isSuperAdmin)SLF.auth.superAdminData().catch(()=>{});}).catch(()=>{});
    refreshAccountPanel();
  }

  function safeText(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  async function refreshAccountPanel(){
    try{
      const session=await SLF.auth.session();if(!session){accountRoot.hidden=true;return;}
      const user=session.user,profile=await SLF.auth.profile(user.id).catch(()=>null),memberships=await SLF.auth.memberships(user.id).catch(()=>[]),saved=SLF.auth.savedWorkspace();
      const membership=memberships.find(item=>item.department?.id===saved?.departmentId)||memberships[0],isSuperAdmin=await SLF.auth.superAdminStatus().catch(()=>false);
      const name=profile?.full_name||user.user_metadata?.full_name||user.user_metadata?.name||user.email||'ผู้ใช้งาน',avatar=profile?.avatar_url||user.user_metadata?.avatar_url||user.user_metadata?.picture||'',department=membership?.department,role=isSuperAdmin?'Super Admin':membership?.role||'User';
      accountRoot.hidden=false;accountRoot.innerHTML=`<div class="app-account-user"><div class="app-account-avatar">${avatar?`<img src="${safeText(avatar)}" alt="">`:safeText(name.slice(0,1).toUpperCase())}</div><div><strong title="${safeText(name)}">${safeText(name)}</strong><small title="${safeText(user.email||'')}">${safeText(department?`${department.organization?.name||''} · ${department.name}`:user.email||'')}</small></div></div><div class="app-account-meta"><span class="app-account-role">${safeText(role)}</span><span class="app-account-sync">เข้าสู่ระบบแล้ว</span></div><div class="app-account-actions"><button id="appSwitchWorkspace">สลับพื้นที่</button><button class="signout" id="appSignOut">ออกจากระบบ</button></div>`;
      accountRoot.querySelector('#appSwitchWorkspace').onclick=()=>{setActiveModule('stock-count');if(SLF.pages.stockCount?.chooseWorkspace)SLF.pages.stockCount.chooseWorkspace();};
      accountRoot.querySelector('#appSignOut').onclick=()=>SLF.auth.signOut();
    }catch(error){accountRoot.hidden=true;}
  }

  async function bootGlobalAuth(){
    authRoot.innerHTML='<div class="sc-auth-loading">กำลังตรวจสอบการเข้าสู่ระบบ...</div>';
    try{const session=await SLF.auth.session();if(session)showAuthenticatedApp();else renderGlobalLogin();}
    catch(error){renderGlobalLogin('ยังเชื่อมต่อระบบเข้าสู่ระบบไม่ได้');}
  }

  const themeSelect = document.getElementById('themeSelect');
  if(themeSelect){
    themeSelect.addEventListener('change', e=>setTheme(e.target.value));
    setTheme(document.documentElement.dataset.theme);
  }

  SLF.appShell = { setActiveModule, setTheme, bootGlobalAuth, refreshAccount:refreshAccountPanel };
  SLF.auth.onChange(session=>{if(session)showAuthenticatedApp();else{shellStarted=false;accountRoot.hidden=true;['dashboardRoot','stockCountRoot','duplicateCheckRoot','superAdminRoot'].forEach(id=>{const el=document.getElementById(id);if(el){delete el.dataset.rendered;el.innerHTML='';}});renderGlobalLogin();}});
  bootGlobalAuth();
})();

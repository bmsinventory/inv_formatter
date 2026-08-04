window.SLF = window.SLF || {};

(function(){
  const STORAGE_KEY = 'bms-mobile-stock-count-v2';

  let rootEl;
  let state = loadState();
  let syncTimer=null;
  let syncStatus='local';
  let authSession=null;
  let userProfile=null;
  let workspace=null;

  function loadState(){
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(saved && Array.isArray(saved.items)){
        saved.role = saved.role || 'counter';
        saved.session = saved.session || {area:'ทั้งหมด',counter:'',roundName:''};
        const savedAreas=[...new Set(saved.items.map(i=>String(i.location||'').split('·')[0].trim()).filter(Boolean))];
        if(saved.session.area!=='ทั้งหมด'&&!savedAreas.includes(saved.session.area)) saved.session.area='ทั้งหมด';
        if(saved.role==='counter' && (saved.view==='setup'||!saved.session.startedAt)) saved.view='start';
        return saved;
      }
    }catch(e){}
    return {role:'counter',view:'start',items:[],countIndex:0,counts:{},session:{area:'ทั้งหมด',counter:'',roundName:''},search:'',queueSearch:''};
  }
  function saveState(){
    state.updatedAt=new Date().toISOString();
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }catch(e){}
  }
  function saveLocalOnly(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){}}
  function scheduleRemoteSave(){
    if(!SLF.stockCountSync||!SLF.stockCountSync.enabled()) return;
    syncStatus='saving';updateSyncBadge();
    clearTimeout(syncTimer);
    syncTimer=setTimeout(async()=>{
      try{await SLF.stockCountSync.push(state);syncStatus='synced';}
      catch(e){syncStatus='offline';}
      updateSyncBadge();
    },500);
  }
  async function loadRemoteState(){
    if(!SLF.stockCountSync||!SLF.stockCountSync.enabled()) return;
    syncStatus='saving';updateSyncBadge();
    try{
      const remote=await SLF.stockCountSync.pull();
      const remoteTime=Date.parse(remote&&remote.updated_at||0);
      const localTime=Date.parse(state.updatedAt||0);
      if(remote&&remote.payload&&remoteTime>localTime){state=remote.payload;saveLocalOnly();renderShell();}
      else if(!remote||localTime>=remoteTime){await SLF.stockCountSync.push(state);}
      syncStatus='synced';
    }catch(e){syncStatus='offline';}
    updateSyncBadge();
  }
  function updateSyncBadge(){
    const badge=rootEl&&rootEl.querySelector('.sc-sync');
    if(!badge)return;
    const labels={local:'เก็บในเครื่อง',saving:'กำลังซิงก์...',synced:'ซิงก์ Supabase แล้ว',offline:'ออฟไลน์ — เก็บในเครื่องแล้ว'};
    badge.classList.toggle('is-offline',syncStatus==='offline');
    badge.innerHTML=`<span></span> ${labels[syncStatus]||labels.local}`;
  }
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatDate(v){
    if(!v) return 'ไม่ระบุ';
    const d = new Date(v);
    return isNaN(d) ? v : d.toLocaleDateString('th-TH',{day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function countFor(code){
    return state.counts[code] || {status:'pending',lots:[],note:''};
  }
  function totalFor(item){
    return countFor(item.code).lots.reduce((sum,l)=>sum + item.packages.reduce((s,p)=>s+(Number(l.qty && l.qty[p.size])||0)*p.size,0),0);
  }
  function statusLabel(status){
    return {done:'นับแล้ว',review:'ต้องตรวจสอบ',missing:'ไม่พบสินค้า',pending:'ยังไม่ได้นับ'}[status] || 'ยังไม่ได้นับ';
  }
  function areas(){
    return [...new Set(state.items.map(i=>i.location.split('·')[0].trim()).filter(Boolean))];
  }
  function activeItems(){
    const area=state.session.area;
    return !area||area==='ทั้งหมด' ? state.items : state.items.filter(i=>i.location.split('·')[0].trim()===area);
  }

  function render(root){
    rootEl = root;
    root.className = 'stock-count-app';
    root.innerHTML='<div class="sc-auth-loading">กำลังตรวจสอบบัญชีผู้ใช้งาน...</div>';
    bootAuth();
  }

  async function bootAuth(){
    try{
      authSession=await SLF.auth.session();
      if(!authSession){renderLogin();return;}
      userProfile=await SLF.auth.profile(authSession.user.id);
      const saved=SLF.auth.savedWorkspace();
      const memberships=await SLF.auth.memberships(authSession.user.id);
      const selected=memberships.find(m=>m.department&&saved&&m.department.id===saved.departmentId);
      if(selected){activateWorkspace(selected);return;}
      if(memberships.length===1){activateWorkspace(memberships[0]);return;}
      await renderWorkspacePicker();
    }catch(error){renderLogin('ยังเชื่อมต่อระบบผู้ใช้งานไม่ได้ กรุณาตรวจสอบการตั้งค่า Supabase และตารางฐานข้อมูล');}
  }
  async function activateWorkspace(membership){
    workspace={organization:membership.department.organization,department:membership.department,role:membership.role};
    state.role=workspace.role==='admin'?'admin':'counter';
    state.session.counter=userProfile?.full_name||authSession.user.email||'';
    rootEl.innerHTML='<div class="sc-auth-loading">กำลังโหลดข้อมูลของหน่วยงาน...</div>';
    try{state.items=await SLF.auth.departmentItems(workspace.department.id);}catch(error){state.items=[];}
    try{state.counts=await SLF.auth.countResults(workspace.department.id);}catch(error){state.counts={};}
    renderShell();
  }
  function renderLogin(message){
    rootEl.innerHTML=`<section class="sc-auth-page"><article class="sc-auth-card">
      <div class="sc-auth-logo">B</div><h2>Mobile Stock Count</h2><p>ลงชื่อเข้าใช้เพื่อร่วมกันตั้งต้นยอด Stock ของหน่วยงาน</p>
      <button class="sc-google-account" id="scGoogleLogin"><span class="sc-auth-avatar">👤</span><span><strong>ลงชื่อเข้าใช้ด้วย Google</strong><small>เลือกบัญชี Google เพื่อเริ่มทำงาน</small></span><span class="g-mark">G</span></button>
      ${message?`<div class="sc-auth-error">${esc(message)}</div>`:''}<small class="sc-auth-note">ระบบจะจดจำการเข้าสู่ระบบบนอุปกรณ์นี้</small>
    </article></section>`;
    rootEl.querySelector('#scGoogleLogin').onclick=()=>SLF.auth.googleOAuth();
    initializeGoogleOneTap();
  }
  function initializeGoogleOneTap(){
    const clientId=SLF.supabaseConfig&&SLF.supabaseConfig.googleClientId;
    if(!clientId||!window.google||!google.accounts||!google.accounts.id)return;
    google.accounts.id.initialize({client_id:clientId,auto_select:false,cancel_on_tap_outside:false,callback:async response=>{
      try{await SLF.auth.googleIdToken(response.credential);await bootAuth();}
      catch(error){renderLogin('ไม่สามารถเข้าสู่ระบบด้วยบัญชี Google นี้ได้');}
    }});
    google.accounts.id.prompt();
  }
  async function renderWorkspacePicker(){
    try{
      const organizations=await SLF.auth.organizations();
      const user=authSession.user,meta=user.user_metadata||{},avatar=meta.avatar_url||meta.picture||'';
      const choices=organizations.flatMap(org=>(org.departments||[]).map(department=>({org,department})));
      rootEl.innerHTML=`<section class="sc-auth-page"><article class="sc-auth-card sc-workspace-card">
        <h2>เลือกพื้นที่ทำงาน</h2><p>เลือกโรงพยาบาลและหน่วยงานสำหรับตั้งต้นยอด Stock</p>
        <div class="sc-user-summary">${avatar?`<img src="${esc(avatar)}" alt="">`:''}<div><strong>${esc(meta.full_name||meta.name||user.email)}</strong><span>${esc(user.email||'')}</span></div></div>
        <div class="sc-workspace-list">${choices.length?choices.map(({org,department})=>`<button data-org="${esc(org.id)}" data-dept="${esc(department.id)}"><span><strong>${esc(department.name)}</strong><small>${esc(org.name)}</small></span><b>→</b></button>`).join(''):'<div class="sc-empty">ยังไม่มีโรงพยาบาลและหน่วยงานในระบบ</div>'}</div>
        <button class="btn" id="scWorkspaceSignOut">ออกจากระบบ</button>
      </article></section>`;
      rootEl.querySelectorAll('[data-dept]').forEach(button=>button.onclick=async()=>{
        button.disabled=true;
        try{
          const joinedRole=await SLF.auth.joinDepartment(user,button.dataset.org,button.dataset.dept);
          userProfile=await SLF.auth.profile(user.id);
          const selected=choices.find(c=>c.department.id===button.dataset.dept);
          workspace={organization:selected.org,department:selected.department,role:joinedRole};
          state.role=joinedRole==='admin'?'admin':'counter';state.session.counter=userProfile?.full_name||user.email||'';
          renderShell();
        }catch(error){button.disabled=false;alert('ไม่สามารถเข้าร่วมหน่วยงานได้ กรุณาตรวจสอบฐานข้อมูล');}
      });
      rootEl.querySelector('#scWorkspaceSignOut').onclick=async()=>{await SLF.auth.signOut();authSession=null;workspace=null;renderLogin();};
    }catch(error){renderLogin('ยังโหลดรายชื่อโรงพยาบาลและหน่วยงานไม่ได้');}
  }

  function renderShell(){
    const scopedItems=activeItems();
    const done = scopedItems.filter(i=>countFor(i.code).status==='done').length;
    const reviewed = scopedItems.filter(i=>countFor(i.code).status==='review').length;
    const missing = scopedItems.filter(i=>countFor(i.code).status==='missing').length;
    const progress = scopedItems.length ? Math.round(((done+reviewed+missing)/scopedItems.length)*100) : 0;
    const isAdmin = workspace?.role==='admin'&&state.role==='admin';
    rootEl.innerHTML = `
      <section class="sc-shell sc-view-${isAdmin?'setup':state.view}">
        <header class="sc-hero">
          <div>
            <span class="sc-eyebrow">${isAdmin?'MASTER DATA ADMIN':'MOBILE STOCK COUNT'}</span>
            <h2>${isAdmin?'จัดการข้อมูลตั้งต้น':'เดินนับยาได้ทันที ไม่ต้องใช้กระดาษ'}</h2>
            <p>${isAdmin?'สำหรับผู้ดูแลข้อมูล: นำเข้าและตรวจรายการยาก่อนเปิดรอบนับ':'สำหรับผู้ตรวจนับ: ค้นหายา บันทึก Package, LOT และ EXP จากหน้าชั้นยา'}</p>
          </div>
          <div class="sc-hero-actions">
            <div class="sc-user-menu">${authSession?.user?.user_metadata?.avatar_url?`<img src="${esc(authSession.user.user_metadata.avatar_url)}" alt="">`:''}<span>${esc(workspace?.department?.name||'')}</span><button id="scChangeWorkspace" title="เปลี่ยนหน่วยงาน">สลับ</button><button id="scSignOut" title="ออกจากระบบ">ออก</button></div>
            <div class="sc-role-badge">${workspace?.role==='admin'?'⚙ Admin':workspace?.role==='staff'?'● Staff':'● User'}</div>
            ${workspace?.role==='admin'?`<button class="sc-role-switch" id="scRoleSwitch">${isAdmin?'← กลับหน้าผู้ตรวจนับ':'⚙ ข้อมูลตั้งต้น'}</button>`:''}
            <div class="sc-sync"><span></span> เก็บในเครื่อง</div>
          </div>
        </header>
        ${isAdmin ? `
          <div class="sc-admin-notice"><span>⚙</span><div><strong>พื้นที่ผู้ดูแลข้อมูล</strong><small>ผู้ตรวจนับจะไม่เห็นเมนูนำเข้าและรายการ Master ในหน้าทำงาน</small></div></div>
        ` : `
          <nav class="sc-tabs sc-counter-tabs" aria-label="เมนูสำหรับผู้ตรวจนับ">
            <button data-view="start" class="${state.view==='start'?'active':''}"><b>1</b><span>เลือกรอบและพื้นที่<small>${esc(state.session.area||'ยังไม่ได้เลือก')}</small></span></button>
            <button data-view="count" class="${state.view==='count'?'active':''}"><b>2</b><span>ค้นหาและเดินนับ<small>${progress}% สำเร็จ</small></span></button>
            <button data-view="progress" class="${state.view==='progress'?'active':''}"><b>3</b><span>ความคืบหน้า<small>${done} นับแล้ว</small></span></button>
          </nav>
        `}
        <div class="sc-content">${isAdmin?setupView():state.view==='start'?startView():state.view==='progress'?progressView():countView()}</div>
      </section>`;
    bindCommon();
    updateSyncBadge();
    if(isAdmin) bindSetup();
    else if(state.view==='start') bindStart();
    else if(state.view==='count') bindCount();
    else if(state.view==='progress') bindProgress();
  }

  function startView(){
    const currentArea=state.session.area||'ทั้งหมด';
    const areaOptions=['ทั้งหมด',...areas()].map(a=>`<option value="${esc(a)}" ${a===currentArea?'selected':''}>${esc(a)}</option>`).join('');
    const active=activeItems(), completed=active.filter(i=>countFor(i.code).status!=='pending').length;
    return `<div class="sc-start-layout">
      <article class="sc-card sc-session-card">
        <div class="sc-card-head"><span class="sc-icon">▶</span><div><h3>เริ่มรอบตรวจนับ</h3><p>เลือกพื้นที่ก่อนเดินไปที่ชั้นยา</p></div></div>
        <div class="sc-session-form">
          <label><span>ชื่อผู้ตรวจนับ</span><input id="scCounterName" value="${esc(userProfile?.full_name||state.session.counter||'')}" readonly></label>
          <label><span>พื้นที่ที่จะนับ</span><select id="scAreaSelect">${areaOptions}</select></label>
        </div>
        <div class="sc-area-preview">
          <div><strong>${active.length}</strong><span>รายการในพื้นที่</span></div>
          <div><strong>${completed}</strong><span>นับแล้ว</span></div>
          <div><strong>${Math.max(0,active.length-completed)}</strong><span>รอนับ</span></div>
        </div>
        <button class="btn btn-primary sc-session-start" id="scBeginSession">${state.session.startedAt?'นับต่อจากครั้งล่าสุด':'เริ่มเดินนับ'} →</button>
      </article>
      <article class="sc-card sc-flow-card">
        <div class="sc-card-head"><span class="sc-icon alt">✓</span><div><h3>ขั้นตอนทำงาน</h3><p>ทำตามลำดับ ไม่ต้องกลับมาคีย์ซ้ำ</p></div></div>
        <div class="sc-flow-steps">
          <div><b>1</b><span><strong>เลือกพื้นที่</strong><small>เลือกตู้หรือโซนที่กำลังจะเดินนับ</small></span></div>
          <div><b>2</b><span><strong>ค้นหารายการยา</strong><small>ค้นหาจากชื่อ รหัสรายการ Barcode หรือตำแหน่ง</small></span></div>
          <div><b>3</b><span><strong>นับ Package และ LOT</strong><small>ระบบรวมเป็นหน่วยเล็กสุดให้ทันที</small></span></div>
          <div><b>4</b><span><strong>ตรวจความคืบหน้า</strong><small>กลับมาแก้รายการที่ข้ามไว้ได้ตลอด</small></span></div>
        </div>
      </article>
    </div>`;
  }

  function setupView(){
    return `
      <div class="sc-setup-grid">
        <article class="sc-card sc-import-card">
          <div class="sc-card-head"><span class="sc-icon">⇧</span><div><h3>นำเข้าข้อมูลตั้งต้น</h3><p>รองรับ Excel และ CSV ระบบจะตรวจจับคอลัมน์ให้อัตโนมัติ</p></div></div>
          <label class="sc-upload" for="scMasterFile">
            <input id="scMasterFile" type="file" accept=".xlsx,.xls,.csv">
            <span class="sc-upload-icon">▣</span>
            <strong>แตะเพื่อเลือกไฟล์ข้อมูลยา</strong>
            <small>.xlsx · .xls · .csv</small>
          </label>
          <div class="sc-import-hint">
            <strong>คอลัมน์ที่แนะนำ</strong>
            <div class="sc-chips"><span>รหัสยา</span><span>ชื่อยา</span><span>ตำแหน่ง</span><span>หน่วยบรรจุ</span><span>ขนาดบรรจุ</span><span>Barcode</span><span>LOT</span><span>EXP</span></div>
          </div>
          <div class="sc-import-actions">
            <button class="btn" id="scDownloadMasterTemplate">ดาวน์โหลด Template ข้อมูลพื้นฐาน</button>
            <span id="scImportStatus">ข้อมูลจะถูกเก็บในอุปกรณ์นี้</span>
          </div>
        </article>
        <article class="sc-card">
          <div class="sc-card-head"><span class="sc-icon alt">✓</span><div><h3>ข้อมูลพร้อมใช้งาน</h3><p>ตรวจรายการก่อนเริ่มเดินนับ</p></div></div>
          <div class="sc-master-summary">
            <div><strong>${state.items.length}</strong><span>รายการยา</span></div>
            <div><strong>${new Set(state.items.map(i=>i.location.split('·')[0].trim())).size}</strong><span>พื้นที่จัดเก็บ</span></div>
            <div><strong>${state.items.reduce((n,i)=>n+i.packages.length,0)}</strong><span>รูปแบบบรรจุ</span></div>
          </div>
          <label class="sc-search"><span>⌕</span><input id="scMasterSearch" value="${esc(state.search)}" placeholder="ค้นหารหัส ชื่อยา หรือตำแหน่ง"></label>
          <div class="sc-master-list">${masterRows()}</div>
            <button class="btn btn-primary sc-start-btn" id="scStartCount" ${state.items.length?'':'disabled'}>ตรวจเสร็จแล้ว กลับหน้าเดินนับ <span>→</span></button>
        </article>
      </div>`;
  }

  function masterRows(){
    const q = state.search.toLowerCase().trim();
    const rows = state.items.filter(i=>!q||`${i.code} ${i.name} ${i.location}`.toLowerCase().includes(q)).slice(0,30);
    if(!rows.length) return '<div class="sc-empty">ไม่พบรายการที่ค้นหา</div>';
    return rows.map(i=>`<div class="sc-master-row">
      <div class="sc-drug-mark">${esc(i.code.slice(0,2))}</div>
      <div><strong>${esc(i.name)}</strong><span>${esc(i.code)} · ${esc(i.location)}</span></div>
      <div class="sc-package-count">${i.packages.length} Package</div>
    </div>`).join('');
  }

  function countView(){
    if(!state.items.length) return '<div class="sc-card sc-empty">กรุณานำเข้าข้อมูลตั้งต้นก่อนเริ่มนับ</div>';
    const active=activeItems();
    if(!active.length) return '<div class="sc-card sc-empty">ไม่พบรายการยาในพื้นที่ที่เลือก กรุณากลับไปเลือกพื้นที่ใหม่</div>';
    if(!active.includes(state.items[state.countIndex])) state.countIndex=state.items.indexOf(active[0]);
    const item = state.items[state.countIndex];
    const count = countFor(item.code);
    const lots = count.lots.length ? count.lots : [{lot:'',exp:'',qty:{}}];
    const complete = active.filter(i=>countFor(i.code).status!=='pending').length;
    return `
      <div class="sc-count-layout">
        <aside class="sc-queue sc-card">
          <div class="sc-queue-head"><strong>${esc(state.session.area||'รายการทั้งหมด')}</strong><span>${complete}/${active.length}</span></div>
          <div class="sc-progress"><i style="width:${active.length?complete/active.length*100:0}%"></i></div>
          <label class="sc-search compact"><span>⌕</span><input id="scQueueSearch" value="${esc(state.queueSearch||'')}" autocomplete="off" enterkeyhint="search" placeholder="ค้นหาชื่อยา รหัส Barcode หรือตำแหน่ง"></label>
          <div class="sc-queue-list">${queueRows()}</div>
        </aside>
        <article class="sc-count-card sc-card" data-code="${esc(item.code)}">
          <div class="sc-item-top">
            <div class="sc-location"><span>⌖</span>${esc(item.location)}</div>
            <div class="sc-item-order">${active.indexOf(item)+1} / ${active.length}</div>
          </div>
          <div class="sc-drug-title">
            <div class="sc-drug-mark large">${esc(item.code.slice(0,2))}</div>
            <div><span>${esc(item.code)}</span><h3>${esc(item.name)}</h3><small>หน่วยเล็กสุด: ${esc(item.baseUnit)}</small></div>
          </div>
          <div class="sc-lot-list">${lots.map((l,idx)=>lotCard(item,l,idx)).join('')}</div>
          <button class="sc-add-lot" id="scAddLot">＋ เพิ่ม LOT ที่พบ</button>
          <div class="sc-count-total"><div><span>รวมทั้งหมด</span><small>คำนวณจากทุก Package และทุก LOT</small></div><strong id="scGrandTotal">${totalFromLots(item,lots).toLocaleString()} <small>${esc(item.baseUnit)}</small></strong></div>
          <label class="sc-note"><span>หมายเหตุ</span><input id="scCountNote" value="${esc(count.note)}" placeholder="เช่น พบยาวางผิดตำแหน่ง"></label>
          <div class="sc-count-actions">
            <button class="btn sc-missing" id="scMissing"><span aria-hidden="true">∅</span> ไม่พบ</button>
            <button class="btn sc-review" id="scReview"><span aria-hidden="true">!</span> ตรวจภายหลัง</button>
            <button class="btn btn-primary" id="scSaveNext">บันทึกและถัดไป <span aria-hidden="true">→</span></button>
          </div>
        </article>
      </div>`;
  }

  function lotCard(item,l,idx){
    return `<section class="sc-lot-card" data-lot-index="${idx}">
      <div class="sc-lot-head"><strong>LOT ${idx+1}</strong>${idx?`<button class="sc-remove-lot" data-remove-lot="${idx}" aria-label="ลบ LOT">×</button>`:'<span>กรอกข้อมูลจากฉลาก</span>'}</div>
      <div class="sc-lot-fields">
        <label><span>เลข LOT</span><input data-field="lot" value="${esc(l.lot)}" placeholder="กรอกเลข LOT"></label>
        <label><span>วันหมดอายุ (EXP)</span><input data-field="exp" inputmode="numeric" value="${esc(l.exp)}" placeholder="DD/MM/YYYY หรือ MM/YYYY"></label>
      </div>
      <div class="sc-package-grid">${item.packages.map(p=>`
        <label class="sc-package">
          <span><strong>${esc(p.name)}</strong><small>× ${p.size.toLocaleString()} ${esc(item.baseUnit)}</small></span>
          <span class="sc-qty-control"><button type="button" data-step="-1" data-size="${p.size}" aria-label="ลดจำนวน ${esc(p.name)}">−</button><input inputmode="numeric" pattern="[0-9]*" aria-label="จำนวน ${esc(p.name)}" data-qty="${p.size}" value="${Number(l.qty && l.qty[p.size])||''}" placeholder="0"><button type="button" data-step="1" data-size="${p.size}" aria-label="เพิ่มจำนวน ${esc(p.name)}">＋</button></span>
        </label>`).join('')}</div>
      <div class="sc-lot-subtotal">รวม LOT นี้ <strong data-subtotal="${idx}">${lotTotal(item,l).toLocaleString()} ${esc(item.baseUnit)}</strong></div>
    </section>`;
  }

  function lotTotal(item,lot){
    return item.packages.reduce((sum,p)=>sum+(Number(lot.qty && lot.qty[p.size])||0)*p.size,0);
  }
  function totalFromLots(item,lots){ return lots.reduce((s,l)=>s+lotTotal(item,l),0); }

  function queueRows(){
    const q=normalizeSearch(state.queueSearch);
    const matches=activeItems().filter(i=>!q||searchText(i).includes(q));
    if(!matches.length) return '<div class="sc-empty sc-queue-empty">ไม่พบรายการที่ค้นหา</div>';
    return matches.map(i=>{
      const idx=state.items.indexOf(i);
      const c=countFor(i.code);
      return `<button class="sc-queue-row ${idx===state.countIndex?'active':''} ${c.status}" data-index="${idx}">
        <span class="sc-status-dot">${c.status==='done'?'✓':c.status==='review'?'!':c.status==='missing'?'−':idx+1}</span>
        <span><strong>${esc(i.name)}</strong><small>${esc(i.code)} · ${esc(i.location)}</small></span>
      </button>`;
    }).join('');
  }

  function normalizeSearch(value){
    return String(value == null ? '' : value).normalize('NFKC').trim().toLocaleLowerCase('th-TH').replace(/\s+/g,' ');
  }
  function searchText(item){
    return normalizeSearch([item.code,item.name,item.barcode,item.location,item.baseUnit].filter(Boolean).join(' '));
  }

  function progressView(){
    const scoped=activeItems();
    const statuses=['done','review','missing','pending'];
    const nums=Object.fromEntries(statuses.map(s=>[s,scoped.filter(i=>countFor(i.code).status===s).length]));
    const filtered=scoped.filter(i=>state.progressFilter==='all'||!state.progressFilter||countFor(i.code).status===state.progressFilter);
    return `<div class="sc-progress-view">
      <div class="sc-stat-grid">
        <button data-filter="all"><strong>${scoped.length}</strong><span>ทั้งหมด</span></button>
        <button data-filter="done" class="done"><strong>${nums.done}</strong><span>นับแล้ว</span></button>
        <button data-filter="review" class="review"><strong>${nums.review}</strong><span>ต้องตรวจสอบ</span></button>
        <button data-filter="missing" class="missing"><strong>${nums.missing}</strong><span>ไม่พบสินค้า</span></button>
        <button data-filter="pending"><strong>${nums.pending}</strong><span>ยังไม่ได้นับ</span></button>
      </div>
      <article class="sc-card">
        <div class="sc-card-head"><span class="sc-icon alt">≡</span><div><h3>รายการตรวจนับ</h3><p>แตะรายการเพื่อกลับไปแก้ไขข้อมูล</p></div></div>
        <div class="sc-result-list">${filtered.map(i=>{const c=countFor(i.code);return `<button data-open-code="${esc(i.code)}"><span class="sc-status-dot ${c.status}">${c.status==='done'?'✓':c.status==='review'?'!':c.status==='missing'?'−':'○'}</span><span><strong>${esc(i.name)}</strong><small>${esc(i.code)} · ${esc(i.location)}</small></span><span class="sc-result-total">${totalFor(i).toLocaleString()} ${esc(i.baseUnit)}<small>${statusLabel(c.status)}</small></span></button>`}).join('')}</div>
      </article>
    </div>`;
  }

  function bindCommon(){
    const changeWorkspace=rootEl.querySelector('#scChangeWorkspace');
    if(changeWorkspace)changeWorkspace.onclick=()=>renderWorkspacePicker();
    const signOut=rootEl.querySelector('#scSignOut');
    if(signOut)signOut.onclick=async()=>{await SLF.auth.signOut();authSession=null;workspace=null;renderLogin();};
    rootEl.querySelectorAll('.sc-tabs button').forEach(b=>b.onclick=()=>{
      if(b.dataset.view==='count'&&!state.session.startedAt){state.view='start';}
      else state.view=b.dataset.view;
      saveState();renderShell();
    });
    const roleSwitch=rootEl.querySelector('#scRoleSwitch');
    if(roleSwitch)roleSwitch.onclick=()=>{
      state.role=state.role==='admin'?'counter':'admin';
      state.view=state.role==='admin'?'setup':'start';
      saveState();renderShell();
    };
  }
  function bindStart(){
    const area=rootEl.querySelector('#scAreaSelect');
    area.onchange=()=>{
      state.session.counter=rootEl.querySelector('#scCounterName').value;
      state.session.area=area.value;saveState();renderShell();
    };
    rootEl.querySelector('#scBeginSession').onclick=()=>{
      state.session.counter=rootEl.querySelector('#scCounterName').value.trim()||'ผู้ตรวจนับ';
      state.session.area=area.value;
      state.session.startedAt=state.session.startedAt||new Date().toISOString();
      const first=activeItems().find(i=>countFor(i.code).status==='pending')||activeItems()[0];
      if(first) state.countIndex=state.items.indexOf(first);
      state.view='count';saveState();renderShell();
    };
  }
  function bindSetup(){
    const search=rootEl.querySelector('#scMasterSearch');
    search.oninput=()=>{state.search=search.value;rootEl.querySelector('.sc-master-list').innerHTML=masterRows();};
    rootEl.querySelector('#scDownloadMasterTemplate').onclick=downloadMasterTemplate;
    rootEl.querySelector('#scStartCount').onclick=()=>{state.role='counter';state.view='start';state.countIndex=0;saveState();renderShell();};
    rootEl.querySelector('#scMasterFile').onchange=e=>importMaster(e.target.files[0]);
  }
  function bindCount(){
    if(!rootEl.querySelector('.sc-count-card')) return;
    const bindQueueRows=()=>rootEl.querySelectorAll('.sc-queue-row').forEach(b=>b.onclick=()=>{
        const current=state.items[state.countIndex];
        saveCurrent(countFor(current.code).status);
        state.countIndex=Number(b.dataset.index);
        state.queueSearch='';
        saveState();renderShell();
      });
    bindQueueRows();
    const queueSearch=rootEl.querySelector('#scQueueSearch');
    queueSearch.oninput=e=>{
      state.queueSearch=e.target.value;
      rootEl.querySelector('.sc-queue-list').innerHTML=queueRows();
      bindQueueRows();
    };
    queueSearch.onkeydown=e=>{
      if(e.key!=='Enter') return;
      const first=rootEl.querySelector('.sc-queue-row');
      if(first){e.preventDefault();first.click();}
    };
    rootEl.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>{
      const input=b.parentElement.querySelector('input');
      input.value=Math.max(0,(Number(input.value)||0)+Number(b.dataset.step));
      updateTotals();
    });
    rootEl.querySelectorAll('[data-qty]').forEach(i=>i.oninput=updateTotals);
    rootEl.querySelector('#scAddLot').onclick=()=>{const draft=readCurrentLots();draft.push({lot:'',exp:'',qty:{}});putDraft(draft);renderShell();};
    rootEl.querySelectorAll('[data-remove-lot]').forEach(b=>b.onclick=()=>{const draft=readCurrentLots();draft.splice(Number(b.dataset.removeLot),1);putDraft(draft);renderShell();});
    rootEl.querySelector('#scSaveNext').onclick=()=>{saveCurrent('done');goNext();};
    rootEl.querySelector('#scReview').onclick=()=>{saveCurrent('review');goNext();};
    rootEl.querySelector('#scMissing').onclick=()=>{saveCurrent('missing');goNext();};
  }

  function goNext(){
    const active=activeItems(), current=state.items[state.countIndex], pos=active.indexOf(current);
    if(pos<active.length-1) state.countIndex=state.items.indexOf(active[pos+1]);
    else state.view='progress';
    saveState();renderShell();
  }
  function readCurrentLots(){
    return [...rootEl.querySelectorAll('.sc-lot-card')].map(card=>{
      const qty={};
      card.querySelectorAll('[data-qty]').forEach(i=>qty[i.dataset.qty]=Number(i.value)||0);
      return {lot:card.querySelector('[data-field="lot"]').value.trim(),exp:card.querySelector('[data-field="exp"]').value,qty};
    });
  }
  function putDraft(lots){
    const item=state.items[state.countIndex], old=countFor(item.code);
    state.counts[item.code]={...old,lots};saveState();
  }
  function saveCurrent(status){
    const item=state.items[state.countIndex];
    const lots=readCurrentLots(),note=rootEl.querySelector('#scCountNote').value.trim();
    state.counts[item.code]={status,lots,note,counterName:userProfile?.full_name||state.session.counter||''};
    saveState();
    SLF.auth.saveCount(workspace.department.id,item.code,status,lots,note,userProfile?.full_name||state.session.counter||'',item.packages).catch(()=>{syncStatus='offline';updateSyncBadge();});
  }
  function updateTotals(){
    const item=state.items[state.countIndex], lots=readCurrentLots();
    rootEl.querySelectorAll('[data-subtotal]').forEach((el,idx)=>el.textContent=`${lotTotal(item,lots[idx]).toLocaleString()} ${item.baseUnit}`);
    rootEl.querySelector('#scGrandTotal').innerHTML=`${totalFromLots(item,lots).toLocaleString()} <small>${esc(item.baseUnit)}</small>`;
  }
  function bindProgress(){
    rootEl.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.progressFilter=b.dataset.filter;renderShell();});
    rootEl.querySelectorAll('[data-open-code]').forEach(b=>b.onclick=()=>{state.countIndex=state.items.findIndex(i=>i.code===b.dataset.openCode);state.view='count';renderShell();});
  }

  function normalizeHeader(v){ return String(v||'').trim().toLowerCase().replace(/[\s_.()-]/g,''); }
  function findCol(headers,words){
    return headers.findIndex(h=>words.some(w=>normalizeHeader(h).includes(normalizeHeader(w))));
  }
  function excelDate(v){
    if(!v) return '';
    if(typeof v==='number' && window.XLSX){const d=XLSX.SSF.parse_date_code(v);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}
    const d=new Date(v); return isNaN(d)?'':d.toISOString().slice(0,10);
  }
  function downloadMasterTemplate(){
    const wb=XLSX.utils.book_new();
    const sheets={
      'คำแนะนำ':[
        ['BMS Mobile Stock Count - Template ข้อมูลพื้นฐาน'],
        ['กรอกข้อมูลในชีตที่เกี่ยวข้อง ห้ามเปลี่ยนชื่อชีตหรือชื่อคอลัมน์'],
        ['role รองรับเฉพาะ admin, staff, user'],
        ['package_size ต้องเป็นตัวเลขมากกว่า 0']
      ],
      'Organizations':[['organization_code','organization_name']],
      'Departments':[['organization_code','department_code','department_name']],
      'Items':[['organization_code','item_code','item_name','base_unit','barcode','category']],
      'Packages':[['organization_code','item_code','package_name','package_size','barcode']],
      'Department_Items':[['organization_code','department_code','item_code','location']],
      'Users':[['email','organization_code','department_code','role']]
    };
    Object.entries(sheets).forEach(([name,rows])=>{
      const ws=XLSX.utils.aoa_to_sheet(rows);
      ws['!cols']=rows[0].map((_,index)=>({wch:index===2?28:20}));
      XLSX.utils.book_append_sheet(wb,ws,name);
    });
    XLSX.writeFile(wb,'BMS_Stock_Count_Master_Data_Template.xlsx');
  }

  function rowsFromSheet(wb,name){
    const ws=wb.Sheets[name];
    return ws?XLSX.utils.sheet_to_json(ws,{defval:'',raw:false}).map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[normalizeHeader(key),String(value).trim()]))):[];
  }
  function valueOf(row,...keys){for(const key of keys){const value=row[normalizeHeader(key)];if(value!=='')return value;}return '';}
  async function importMasterWorkbook(wb){
    const itemRows=rowsFromSheet(wb,'Items');
    if(!itemRows.length) return false;
    const packageRows=rowsFromSheet(wb,'Packages');
    const departmentRows=rowsFromSheet(wb,'Department_Items');
    const items=itemRows.map(row=>{
      const code=valueOf(row,'item_code','รหัสรายการ','รหัสยา');
      const packages=packageRows.filter(p=>valueOf(p,'item_code')===code).map(p=>({name:valueOf(p,'package_name','หน่วยบรรจุ')||valueOf(row,'base_unit')||'หน่วย',size:Math.max(1,Number(valueOf(p,'package_size','ขนาดบรรจุ'))||1),barcode:valueOf(p,'barcode')}));
      const dept=departmentRows.find(d=>valueOf(d,'item_code')===code);
      return {code,name:valueOf(row,'item_name','ชื่อรายการ','ชื่อยา'),location:dept?valueOf(dept,'location','ตำแหน่ง'):'',barcode:valueOf(row,'barcode'),baseUnit:valueOf(row,'base_unit','หน่วยฐาน')||'หน่วย',category:valueOf(row,'category','ประเภท'),packages:packages.length?packages:[{name:valueOf(row,'base_unit')||'หน่วย',size:1}],lots:[]};
    }).filter(item=>item.code&&item.name);
    if(!items.length)throw new Error('ไม่พบข้อมูล Item ที่สมบูรณ์');
    if(SLF.auth.importMasterData)await SLF.auth.importMasterData(workspace.organization.id,workspace.department.id,{items,itemRows,packageRows,departmentRows,organizationRows:rowsFromSheet(wb,'Organizations'),departments:rowsFromSheet(wb,'Departments'),users:rowsFromSheet(wb,'Users')});
    state.items=items;state.counts={};state.search='';saveState();renderShell();return true;
  }
  function importMaster(file){
    if(!file) return;
    const status=rootEl.querySelector('#scImportStatus');
    status.textContent='กำลังอ่านไฟล์...';
    const reader=new FileReader();
    reader.onerror=()=>status.textContent='ไม่สามารถอ่านไฟล์นี้ได้';
    reader.onload=e=>{
      try{
        const wb=XLSX.read(e.target.result,{type:'array'});
        if(wb.SheetNames.includes('Items')){
          Promise.resolve(importMasterWorkbook(wb)).catch(()=>{
            const current=rootEl.querySelector('#scImportStatus');if(current)current.textContent='นำเข้าไม่สำเร็จ กรุณาตรวจสอบ Template และสิทธิ์ Admin';
          });
          return;
        }
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
        const headerIndex=rows.findIndex(r=>r.filter(Boolean).length>=3);
        const headers=rows[headerIndex]||[];
        const cols={
          code:findCol(headers,['รหัสเดิม','รหัสยา','itemcode','code','รหัส inv']),
          name:findCol(headers,['ชื่อรายการ','ชื่อยา','itemname','name']),
          location:findCol(headers,['ตำแหน่ง','location','ชั้น','ที่เก็บ']),
          unit:findCol(headers,['หน่วยบรรจุ','หน่วย','unit']),
          size:findCol(headers,['ขนาดบรรจุ','packsize','conversion']),
          barcode:findCol(headers,['barcode','บาร์โค้ด']),
          lot:findCol(headers,['lot','ล็อต']),
          exp:findCol(headers,['exp','วันหมดอายุ','expire'])
        };
        if(cols.code<0||cols.name<0) throw new Error('missing columns');
        const grouped=new Map();
        rows.slice(headerIndex+1).forEach(r=>{
          const code=String(r[cols.code]||'').trim(), name=String(r[cols.name]||'').trim();
          if(!code||!name)return;
          if(!grouped.has(code)) grouped.set(code,{code,name,location:cols.location>=0?String(r[cols.location]||'ยังไม่ระบุตำแหน่ง'):'ยังไม่ระบุตำแหน่ง',barcode:cols.barcode>=0?String(r[cols.barcode]||''):'',baseUnit:cols.unit>=0?String(r[cols.unit]||'หน่วย'):'หน่วย',packages:[],lots:[]});
          const item=grouped.get(code), size=Math.max(1,Number(r[cols.size])||1), unit=cols.unit>=0?String(r[cols.unit]||item.baseUnit):item.baseUnit;
          if(!item.packages.some(p=>p.size===size))item.packages.push({name:unit,size});
          const lot=cols.lot>=0?String(r[cols.lot]||'').trim():'';
          if(lot&&!item.lots.some(l=>l.lot===lot))item.lots.push({lot,exp:cols.exp>=0?excelDate(r[cols.exp]):''});
        });
        state.items=[...grouped.values()];state.counts={};state.search='';saveState();renderShell();
      }catch(err){
        status.textContent='ไม่พบคอลัมน์รหัสยาและชื่อยา กรุณาตรวจหัวตาราง';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.stockCount = { render };
})();

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
  let stopLiveSync=null,stopEditRequestSync=null;
  let currentLock=null,lockTimer=null,presenceTimer=null,presenceDepartmentId=null,editRequestPollTimer=null;
  const editRetryTimers=new Map();
  window.addEventListener('pagehide',()=>{if(presenceDepartmentId)SLF.auth.leaveStockPresence(presenceDepartmentId).catch(()=>{});});

  function loadState(){
    try{
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if(saved && Array.isArray(saved.items)){
        saved.role = 'counter';
        saved.session = saved.session || {area:'ทั้งหมด',counter:'',roundName:''};
        saved.session.area='ทั้งหมด';
        if(!saved.session.startedAt)saved.session.startedAt=new Date().toISOString();
        if(!['count','progress'].includes(saved.view))saved.view='count';
        return saved;
      }
    }catch(e){}
    return {role:'counter',view:'count',items:[],countIndex:0,counts:{},session:{area:'ทั้งหมด',counter:'',roundName:'',startedAt:new Date().toISOString()},search:'',queueSearch:''};
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
  function itemKey(item){return String(item&&typeof item==='object'?(item.itemId||item.code):item||'');}
  function countFor(item){
    return state.counts[itemKey(item)] || (item&&typeof item==='object'?state.counts[item.code]:null) || {status:'pending',lots:[],note:''};
  }
  function totalFor(item){
    return countFor(item).lots.reduce((sum,l)=>sum + item.packages.reduce((s,p)=>s+(Number(l.qty && l.qty[p.size])||0)*p.size,0),0);
  }
  function valueFor(item){return totalFor(item)*(Number(item.unitPrice)||0);}
  function formatMoney(value){return new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB',minimumFractionDigits:2}).format(Number(value)||0);}
  function statusLabel(status){
    return {done:'นับแล้ว',review:'ต้องตรวจสอบ',missing:'ไม่พบสินค้า',pending:'ยังไม่ได้นับ'}[status] || 'ยังไม่ได้นับ';
  }
  function activeItems(){
    return state.items;
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
      const saved=SLF.auth.savedWorkspace(authSession.user.id);
      const [profile,memberships,isSuperAdmin]=await Promise.all([SLF.auth.profile(authSession.user.id),SLF.auth.memberships(authSession.user.id),SLF.auth.superAdminStatus()]);userProfile=profile;
      const superAdminNav=document.querySelector('[data-module="super-admin"]');if(superAdminNav)superAdminNav.hidden=!isSuperAdmin;
      const selected=memberships.find(m=>m.department&&saved&&m.department.id===saved.departmentId);
      if(selected){await activateWorkspace(selected);return;}
      if(SLF.appShell?.chooseWorkspace){await SLF.appShell.chooseWorkspace();return;}
      await renderWorkspacePicker();
    }catch(error){renderLogin('ยังเชื่อมต่อระบบผู้ใช้งานไม่ได้ กรุณาตรวจสอบการตั้งค่า Supabase และตารางฐานข้อมูล');}
  }
  async function activateWorkspace(membership){
    workspace={organization:membership.department.organization,department:membership.department,role:membership.role};
    startPresence(workspace.department.id);
    state.role='counter';
    state.session.counter=userProfile?.full_name||authSession.user.email||'';
    state.session.area='ทั้งหมด';state.session.startedAt=state.session.startedAt||new Date().toISOString();state.view='count';
    renderShell();
    const [items,counts]=await Promise.all([SLF.auth.departmentItems(workspace.department.id).catch(()=>state.items||[]),SLF.auth.countResults(workspace.department.id).catch(()=>state.counts||{})]);state.items=items;state.counts=counts;
    if(stopLiveSync)stopLiveSync();stopLiveSync=SLF.auth.subscribeDepartment(workspace.department.id,async()=>{const [freshItems,freshCounts]=await Promise.all([SLF.auth.departmentItems(workspace.department.id),SLF.auth.countResults(workspace.department.id)]);state.items=freshItems;state.counts=freshCounts;saveState();renderShell();});
    if(stopEditRequestSync)stopEditRequestSync();stopEditRequestSync=SLF.auth.subscribeLotEditRequests(workspace.department.id,handleEditRequestEvent);checkPendingEditRequests();
    if(SLF.appShell?.refreshAccount)SLF.appShell.refreshAccount();
    saveState();renderShell();
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
        <div class="sc-workspace-list">${choices.length?choices.map(({org,department})=>`<button data-org="${esc(org.id)}" data-dept="${esc(department.id)}"><span><strong>${esc(department.name)}</strong><small>${esc(org.name)}</small></span><b>→</b></button>`).join(''):`<div class="sc-empty"><strong>ยังไม่มีโรงพยาบาลและหน่วยงานในระบบ</strong><p>ผู้ดูแลระบบคนแรกสามารถนำเข้า Organizations และ Departments เพื่อเริ่มต้นระบบได้</p></div>
          <button class="btn" id="scBootstrapTemplate">ดาวน์โหลด Template ข้อมูลพื้นฐาน</button>
          <label class="sc-upload" for="scBootstrapFile"><input id="scBootstrapFile" type="file" accept=".xlsx,.xls"><span class="sc-upload-icon">⇧</span><strong>เลือกไฟล์ที่กรอกแล้วเพื่อนำเข้า</strong><small>สร้างโรงพยาบาล หน่วยงาน และนำเข้าข้อมูลต่อจากไฟล์เดียวกัน</small></label>
          <div id="scBootstrapStatus" class="sc-auth-error" hidden></div>`}</div>
        <button class="btn" id="scWorkspaceSignOut">ออกจากระบบ</button>
      </article></section>`;
      rootEl.querySelectorAll('[data-dept]').forEach(button=>button.onclick=async()=>{
        button.disabled=true;
        try{
          const joinedRole=await SLF.auth.joinDepartment(user,button.dataset.org,button.dataset.dept);
          userProfile=await SLF.auth.profile(user.id);
          const selected=choices.find(c=>c.department.id===button.dataset.dept);
          workspace={organization:selected.org,department:selected.department,role:joinedRole};
          startPresence(workspace.department.id);
          state.role='counter';state.session.counter=userProfile?.full_name||user.email||'';state.session.area='ทั้งหมด';state.session.startedAt=state.session.startedAt||new Date().toISOString();state.view='count';
          if(SLF.appShell?.refreshAccount)SLF.appShell.refreshAccount();
          renderShell();
        }catch(error){button.disabled=false;SLF.components.alertModal('เข้าร่วมหน่วยงานไม่สำเร็จ','กรุณาตรวจสอบการเชื่อมต่อและสิทธิ์ฐานข้อมูล','error');}
      });
      const bootstrapTemplate=rootEl.querySelector('#scBootstrapTemplate');if(bootstrapTemplate)bootstrapTemplate.onclick=downloadMasterTemplate;
      const bootstrapFile=rootEl.querySelector('#scBootstrapFile');if(bootstrapFile)bootstrapFile.onchange=e=>bootstrapWorkspaceFromFile(e.target.files[0]);
      rootEl.querySelector('#scWorkspaceSignOut').onclick=async()=>{await SLF.auth.signOut();authSession=null;workspace=null;renderLogin();};
    }catch(error){renderLogin('ยังโหลดรายชื่อโรงพยาบาลและหน่วยงานไม่ได้');}
  }

  function bootstrapWorkspaceFromFile(file){
    if(!file)return;
    const reader=new FileReader();
    reader.onerror=()=>{const status=rootEl.querySelector('#scBootstrapStatus');if(status){status.hidden=false;status.textContent='ไม่สามารถอ่านไฟล์นี้ได้';}};
    reader.onload=e=>{
      try{
        const wb=XLSX.read(e.target.result,{type:'array'}),organizations=rowsFromSheet(wb,'Organizations'),departments=rowsFromSheet(wb,'Departments');
        const orgRow=organizations[0];if(!orgRow)throw new Error('ไม่พบข้อมูลใน Sheet Organizations');
        const organization={code:valueOf(orgRow,'organization_code'),name:valueOf(orgRow,'organization_name')};
        const deptRow=departments.find(row=>valueOf(row,'organization_code')===organization.code)||departments[0];
        if(!organization.code||!organization.name||!deptRow)throw new Error('ข้อมูล Organizations หรือ Departments ไม่สมบูรณ์');
        const department={code:valueOf(deptRow,'department_code'),name:valueOf(deptRow,'department_name')};
        if(!department.code||!department.name)throw new Error('ข้อมูล Department ไม่สมบูรณ์');
        showBootstrapPreview(organization,department,wb);
      }catch(error){const status=rootEl.querySelector('#scBootstrapStatus');if(status){status.hidden=false;status.textContent=error.message;}}
    };
    reader.readAsArrayBuffer(file);
  }
  function showBootstrapPreview(organization,department,workbook){
    const modalRoot=document.getElementById('modalRoot');
    modalRoot.innerHTML=`<div class="overlay"><div class="modal"><h3>ยืนยันเริ่มต้นระบบ</h3><p>สร้างโรงพยาบาล <strong>${esc(organization.name)}</strong> (${esc(organization.code)}) และหน่วยงาน <strong>${esc(department.name)}</strong> (${esc(department.code)}) โดยบัญชีปัจจุบันจะเป็น Admin</p><div class="row"><button class="btn" id="scCancelBootstrap">ยกเลิก</button><button class="btn btn-primary" id="scConfirmBootstrap">ยืนยันนำเข้าข้อมูล</button></div></div></div>`;
    modalRoot.querySelector('#scCancelBootstrap').onclick=()=>modalRoot.innerHTML='';
    modalRoot.querySelector('#scConfirmBootstrap').onclick=async()=>{
      const button=modalRoot.querySelector('#scConfirmBootstrap');button.disabled=true;button.textContent='กำลังสร้าง...';
      try{
        await SLF.auth.bootstrapWorkspace(organization,department);modalRoot.innerHTML='';userProfile=await SLF.auth.profile(authSession.user.id);await bootAuth();
        if(workbook.SheetNames.includes('Items')&&rowsFromSheet(workbook,'Items').length)showMasterImportPreview(prepareMasterWorkbook(workbook));
      }
      catch(error){modalRoot.innerHTML='';const status=rootEl.querySelector('#scBootstrapStatus');if(status){status.hidden=false;status.textContent=String(error?.message||error);}}
    };
  }

  function renderShell(){
    document.body.classList.remove('sc-queue-open');
    if(!['count','progress'].includes(state.view))state.view='count';
    const scopedItems=activeItems();
    const done = scopedItems.filter(i=>countFor(i).status==='done').length;
    const reviewed = scopedItems.filter(i=>countFor(i).status==='review').length;
    const missing = scopedItems.filter(i=>countFor(i).status==='missing').length;
    const progress = scopedItems.length ? Math.round(((done+reviewed+missing)/scopedItems.length)*100) : 0;
    rootEl.innerHTML = `
      <section class="sc-shell sc-view-${state.view}">
        <div class="sc-mobile-bar">
          <button type="button" class="sc-mobile-icon" data-mobile-menu aria-label="เปิดเมนูหลัก">☰</button>
          <button type="button" class="sc-mobile-current" data-mobile-progress><strong>${state.view==='progress'?'ความคืบหน้า':'ตรวจนับสต็อก'}</strong><small>${done+reviewed+missing}/${scopedItems.length} รายการ</small></button>
          ${state.view==='count'?'<button type="button" class="sc-mobile-icon" data-mobile-queue aria-label="ค้นหารายการยา">⌕</button>':'<button type="button" class="sc-mobile-icon" data-mobile-count aria-label="กลับหน้าตรวจนับ">←</button>'}
        </div>
        <header class="sc-hero">
          <div>
            <span class="sc-eyebrow">MOBILE STOCK COUNT</span>
            <h2>ตรวจนับสต็อกได้ทันที ไม่ต้องใช้กระดาษ</h2>
            <p>ค้นหารายการ บันทึกจำนวนตามหน่วยบรรจุ LOT และ EXP จากหน้าชั้นวาง</p>
          </div>
        </header>
        <nav class="sc-tabs sc-counter-tabs" aria-label="เมนูตรวจนับ">
          <button data-view="count" class="${state.view==='count'?'active':''}"><b>1</b><span>ตรวจนับสต็อก<small>${progress}% สำเร็จ</small></span></button>
          <button data-view="progress" class="${state.view==='progress'?'active':''}"><b>2</b><span>ความคืบหน้า<small>${done} นับแล้ว</small></span></button>
        </nav>
        <div class="sc-content">${state.view==='progress'?progressView():countView()}</div>
      </section>`;
    bindCommon();
    updateSyncBadge();
    if(state.view==='count') bindCount();
    else if(state.view==='progress') bindProgress();
  }

  function countView(){
    if(!state.items.length) return '<div class="sc-card sc-empty"><strong>ยังไม่มีรายการสำหรับตรวจนับ</strong><p>กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดรายการให้หน่วยงานนี้</p></div>';
    const active=activeItems();
    if(!active.length) return '<div class="sc-card sc-empty">ยังไม่มีรายการสำหรับตรวจนับในหน่วยงานนี้</div>';
    if(!active.includes(state.items[state.countIndex])) state.countIndex=state.items.indexOf(active[0]);
    const item = state.items[state.countIndex];
    const count = countFor(item);
    const lots = count.lots.length ? count.lots : [{lot:'',exp:'',qty:{}}];
    const complete = active.filter(i=>countFor(i).status!=='pending').length;
    return `
      <div class="sc-count-layout">
        <button type="button" class="sc-queue-scrim" data-close-queue aria-label="ปิดรายการยา"></button>
        <aside class="sc-queue sc-card" aria-label="ค้นหาและเลือกรายการยา">
          <div class="sc-queue-head"><strong>${esc(state.session.area||'รายการทั้งหมด')}</strong><span>${complete}/${active.length}</span><button type="button" class="sc-queue-close" data-close-queue aria-label="ปิดรายการยา">×</button></div>
          <div class="sc-progress"><i style="width:${active.length?complete/active.length*100:0}%"></i></div>
          <label class="sc-search compact"><span aria-hidden="true">🔎</span><input id="scQueueSearch" value="${esc(state.queueSearch||'')}" autocomplete="off" enterkeyhint="search" aria-label="ค้นหารหัสยาหรือชื่อยา" placeholder="ค้นหารหัสยา หรือชื่อยา"></label>
          <div class="sc-queue-list">${queueRows()}</div>
        </aside>
        <article class="sc-count-card sc-card" data-code="${esc(item.code)}">
          <div class="sc-count-lock" id="scCountLock"><span>⏳</span><strong>กำลังตรวจสอบผู้ใช้งาน...</strong></div>
          <div class="sc-item-top">
            <div class="sc-location"><span>⌖</span>${esc(item.location)}</div>
            <div class="sc-item-order">${active.indexOf(item)+1} / ${active.length}</div>
          </div>
          <div class="sc-drug-title">
            <div class="sc-drug-mark large">${esc(item.code.slice(0,2))}</div>
            <div><span>${esc(item.code)}</span><h3>${esc(item.name)}</h3><small>หน่วยเล็กสุด: ${esc(item.baseUnit)} · ราคาต่อหน่วย ${formatMoney(item.unitPrice)}</small></div>
          </div>
          <div class="sc-lot-list">${lots.map((l,idx)=>lotCard(item,l,idx)).join('')}</div>
          <button class="sc-add-lot" id="scAddLot">＋ เพิ่ม LOT ที่พบ</button>
          <div class="sc-count-total"><div><span>รวมทั้งหมด</span><small id="scGrandValue">มูลค่า ${formatMoney(totalFromLots(item,lots)*(Number(item.unitPrice)||0))}</small></div><strong id="scGrandTotal">${totalFromLots(item,lots).toLocaleString()} <small>${esc(item.baseUnit)}</small></strong></div>
          <div class="sc-count-footer"><label class="sc-note"><span>หมายเหตุ (ถ้ามี)</span><input id="scCountNote" value="${esc(count.note)}" placeholder="พิมพ์หมายเหตุ"></label>
          <div class="sc-count-actions">
            <button class="btn sc-missing" id="scMissing"><span aria-hidden="true">∅</span> ไม่พบ</button>
            <button class="btn sc-review" id="scReview"><span aria-hidden="true">!</span> ตรวจภายหลัง</button>
            <button class="btn btn-primary" id="scSaveNext">บันทึกและถัดไป <span aria-hidden="true">→</span></button>
          </div></div>
        </article>
      </div>`;
  }

  function lotCard(item,l,idx){
    const protectedLot=Boolean(l.recordedBy&&l.recordedBy!==authSession?.user?.id);
    const recordedTime=l.recordedAt?new Date(l.recordedAt).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'';
    const ownerAttrs=protectedLot?' data-owner-locked disabled':'';
    return `<section class="sc-lot-card" data-lot-index="${idx}" data-entry-group="${Number(l.entryGroup)||idx+1}">
      <div class="sc-lot-head"><strong>LOT ${idx+1}</strong><span class="sc-lot-subtotal">รวม <strong data-subtotal="${idx}">${lotTotal(item,l).toLocaleString()} ${esc(item.baseUnit)}</strong></span>${idx&&!protectedLot?`<button class="sc-remove-lot" data-remove-lot="${idx}" aria-label="ลบ LOT">×</button>`:''}</div>
      ${l.recordedBy?`<div class="sc-lot-audit"><span>👤 <strong>${esc(l.recordedByName||'ผู้ใช้งาน')}</strong></span><span>🕒 ${esc(recordedTime)}</span><button type="button" data-view-lot-history>📋 ประวัติ</button>${protectedLot?'<button type="button" class="sc-request-edit" data-request-edit>✏️ ขอแก้ไข</button>':''}</div>`:''}
      <div class="sc-lot-entry-row"><div class="sc-lot-fields">
        <label><span>เลข LOT</span><input data-field="lot" value="${esc(l.lot)}" placeholder="กรอกเลข LOT"${ownerAttrs}></label>
        <label><span>วันหมดอายุ (EXP)</span><input data-field="exp" inputmode="numeric" value="${esc(l.exp)}" placeholder="DD/MM/YYYY หรือ MM/YYYY"${ownerAttrs}></label>
      </div><div class="sc-package-grid">${item.packages.map(p=>`
        <label class="sc-package">
          <span><strong>${esc(p.name)}</strong><small>× ${p.size.toLocaleString()} ${esc(item.baseUnit)}</small></span>
          <span class="sc-qty-control"><button type="button" data-step="-1" data-size="${p.size}" aria-label="ลดจำนวน ${esc(p.name)}"${ownerAttrs}>−</button><input inputmode="numeric" pattern="[0-9]*" aria-label="จำนวน ${esc(p.name)}" data-qty="${p.size}" value="${Number(l.qty && l.qty[p.size])||''}" placeholder="0"${ownerAttrs}><button type="button" data-step="1" data-size="${p.size}" aria-label="เพิ่มจำนวน ${esc(p.name)}"${ownerAttrs}>＋</button></span>
        </label>`).join('')}</div></div>
      ${protectedLot?`<div class="sc-edit-reason"><label hidden><span class="sc-edit-reason-title">เหตุผลการแก้ไข <b>*</b></span><span class="sc-edit-status" data-edit-status hidden></span><input data-edit-reason value="${esc(l.editReason||'')}" placeholder="ระบุเหตุผลที่ต้องการแก้ไข"><button type="button" class="btn btn-primary" data-submit-edit>ส่งคำขอ</button></label></div>`:''}
    </section>`;
  }

  function lotTotal(item,lot){
    return item.packages.reduce((sum,p)=>sum+(Number(lot.qty && lot.qty[p.size])||0)*p.size,0);
  }

  function unlockLotForEdit(card){
    clearTimeout(editRetryTimers.get(card.dataset.entryGroup));editRetryTimers.delete(card.dataset.entryGroup);
    card.dataset.editing='true';
    card.querySelectorAll('[data-owner-locked]').forEach(el=>{el.disabled=false;});
    card.classList.remove('is-edit-rejected','is-edit-pending');const status=card.querySelector('[data-edit-status]');if(status){status.hidden=false;status.className='sc-edit-status is-approved';status.textContent='✓ อนุมัติแล้ว';}
    const submit=card.querySelector('[data-submit-edit]');if(submit){submit.disabled=true;submit.textContent='แก้ไขข้อมูลได้';}
  }
  async function submitLotEditRequest(card){
    const reason=card.querySelector('[data-edit-reason]'),submit=card.querySelector('[data-submit-edit]'),item=state.items[state.countIndex];
    if(!reason.value.trim()){await SLF.components.alertModal('กรุณาระบุเหตุผล','ต้องระบุเหตุผลที่ต้องการแก้ไข LOT นี้ก่อนส่งคำขอ','warning');reason.focus();return;}
    card.classList.remove('is-edit-rejected');submit.disabled=true;submit.textContent='กำลังส่ง...';
    try{
      const result=await SLF.auth.requestLotEdit(workspace.department.id,item.itemId||item.code,card.dataset.entryGroup,reason.value.trim(),userProfile?.full_name||authSession?.user?.email||'');
      if(result?.status==='approved'){unlockLotForEdit(card);await SLF.components.alertModal('แก้ไขได้แล้ว',result.requires_approval?'เจ้าของรายการอนุมัติแล้ว':'ผู้บันทึกเดิม Offline ระบบบันทึกเหตุผลไว้และปลดล็อกให้แก้ไขแล้ว','success');}
      else{card.classList.add('is-edit-pending');const status=card.querySelector('[data-edit-status]');if(status){status.hidden=false;status.className='sc-edit-status is-pending';status.textContent='⏳ รออนุมัติ';}submit.textContent='ส่งคำขอแล้ว';scheduleEditApprovalCheck(card);await SLF.components.alertModal('ส่งคำขอเรียบร้อย','ระบบแจ้งผู้บันทึกเดิมให้ตรวจสอบแล้ว\nคุณสามารถปิดหน้าต่างนี้และทำรายการอื่นต่อได้','pending','เข้าใจแล้ว');}
    }catch(error){submit.disabled=false;submit.textContent='ส่งคำขอแก้ไข';await SLF.components.alertModal('ส่งคำขอไม่สำเร็จ',error.message,'error');}
  }
  function scheduleEditApprovalCheck(card){
    const key=card.dataset.entryGroup;clearTimeout(editRetryTimers.get(key));
    editRetryTimers.set(key,setTimeout(async()=>{if(card.dataset.editing==='true'||!document.body.contains(card))return;const reason=card.querySelector('[data-edit-reason]')?.value.trim(),item=state.items[state.countIndex];if(!reason||!item)return;try{const result=await SLF.auth.requestLotEdit(workspace.department.id,item.itemId||item.code,key,reason,userProfile?.full_name||authSession?.user?.email||'');if(result?.status==='approved'){unlockLotForEdit(card);await SLF.components.alertModal('แก้ไขได้แล้ว','ผู้บันทึกเดิม Offline แล้ว ระบบเก็บเหตุผลและปลดล็อก LOT ให้อัตโนมัติ','success');}else scheduleEditApprovalCheck(card);}catch(error){scheduleEditApprovalCheck(card);}},15000));
  }
  function startPresence(departmentId){
    clearInterval(presenceTimer);clearInterval(editRequestPollTimer);if(presenceDepartmentId&&presenceDepartmentId!==departmentId)SLF.auth.leaveStockPresence(presenceDepartmentId).catch(()=>{});presenceDepartmentId=departmentId;
    const touch=async()=>{try{await SLF.auth.touchStockPresence(departmentId,userProfile?.full_name||authSession?.user?.email||'');}catch(error){console.warn('Stock presence heartbeat failed',error);}};
    touch();presenceTimer=setInterval(touch,25000);editRequestPollTimer=setInterval(checkPendingEditRequests,5000);
  }
  async function handleEditRequestEvent(payload){
    const row=payload?.new||payload?.old||{};
    if(row.requester_id===authSession?.user?.id&&row.status==='approved'){
      const card=rootEl?.querySelector(`.sc-lot-card[data-entry-group="${Number(row.entry_group)}"]`);if(card)unlockLotForEdit(card);
      await SLF.components.alertModal('คำขอแก้ไขได้รับอนุมัติ','คุณสามารถแก้ไข LOT ที่ขอไว้ได้แล้ว','success');
    }else if(row.requester_id===authSession?.user?.id&&row.status==='rejected'){
      clearTimeout(editRetryTimers.get(String(row.entry_group)));editRetryTimers.delete(String(row.entry_group));
      const card=rootEl?.querySelector(`.sc-lot-card[data-entry-group="${Number(row.entry_group)}"]`),submit=card?.querySelector('[data-submit-edit]');
      if(card){card.dataset.editing='false';card.classList.remove('is-edit-pending');card.classList.add('is-edit-rejected');const status=card.querySelector('[data-edit-status]');if(status){status.hidden=false;status.className='sc-edit-status is-rejected';status.textContent='✕ ไม่อนุมัติ';}}
      if(submit){submit.disabled=false;submit.textContent='ส่งใหม่';}
      await SLF.components.alertModal('คำขอถูกปฏิเสธ','ผู้บันทึกเดิมไม่อนุมัติการแก้ไข LOT นี้','warning');
    }else if(row.owner_id===authSession?.user?.id&&row.status==='pending')checkPendingEditRequests();
  }
  async function checkPendingEditRequests(){
    try{const requests=await SLF.auth.pendingLotEditRequests(workspace.department.id),request=requests.find(r=>r.owner_id===authSession?.user?.id);if(request)showEditApprovalPopup(request);}catch(error){console.warn('Pending LOT edit request check failed',error);}
  }
  function showEditApprovalPopup(request){
    const modal=document.getElementById('modalRoot');if(!modal||modal.querySelector(`[data-edit-request="${request.id}"]`))return;
    if(modal.innerHTML.trim()){setTimeout(checkPendingEditRequests,1200);return;}
    const item=request.count?.department_item?.item||{},entries=(request.count?.entries||[]).filter(entry=>Number(entry.entry_group)===Number(request.entry_group)),lot=entries.find(entry=>entry.lot||entry.exp)||{};
    modal.innerHTML=`<div class="overlay"><div class="modal sc-edit-approval-modal" data-edit-request="${esc(request.id)}"><div class="sc-edit-approval-head"><div class="sc-edit-approval-icon">✏️</div><div><span class="sc-edit-approval-kicker">คำขอแก้ไข LOT</span><h3>${esc(request.requester_name||'ผู้ใช้งาน')}</h3><p class="sc-edit-approval-caption">ต้องการแก้ไขข้อมูลที่คุณเป็นผู้บันทึก</p></div></div><div class="sc-edit-approval-item"><span>${esc(item.item_id||item.code||'-')}</span><strong>${esc(item.name||'รายการสต๊อก')}</strong><div class="sc-edit-approval-lot"><span><small>LOT</small><b>${esc(lot.lot||'-')}</b></span><span><small>EXP</small><b>${esc(lot.exp||'-')}</b></span></div></div><div class="sc-edit-approval-reason"><span>เหตุผลที่ขอแก้ไข</span><strong>${esc(request.reason||'-')}</strong></div><div class="row"><button class="btn btn-danger" data-reject-edit>✕ ไม่อนุมัติ</button><button class="btn btn-primary" data-approve-edit>✅ อนุมัติให้แก้ไข</button></div></div></div>`;
    const respond=async approved=>{const buttons=modal.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await SLF.auth.respondLotEditRequest(request.id,approved);modal.innerHTML='';checkPendingEditRequests();}catch(error){buttons.forEach(b=>b.disabled=false);await SLF.components.alertModal('ตอบคำขอไม่สำเร็จ',error.message,'error');}};
    modal.querySelector('[data-approve-edit]').onclick=()=>respond(true);modal.querySelector('[data-reject-edit]').onclick=()=>respond(false);
  }
  async function showLotHistory(card){
    const modal=document.getElementById('modalRoot'),item=state.items[state.countIndex];
    modal.innerHTML='<div class="overlay"><div class="modal sc-edit-approval-modal"><div class="sc-edit-approval-icon">📋</div><h3>กำลังโหลดประวัติการแก้ไข...</h3></div></div>';
    try{const rows=await SLF.auth.lotAdjustmentHistory(workspace.department.id,item.itemId||item.code,card.dataset.entryGroup);modal.innerHTML=`<div class="overlay"><div class="modal sc-lot-history-modal"><h3>📋 ประวัติการแก้ไข LOT</h3><p>${esc(item.code)} · ${esc(item.name)}</p><div class="sc-lot-history-list">${rows.length?rows.map(row=>`<article><div><strong>${esc(row.changed_by_name||'ผู้ใช้งาน')}</strong><time>${esc(new Date(row.changed_at).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}))}</time></div><p>${esc(row.lot)} · EXP ${esc(row.exp)} · ${esc(row.stock_item_unit_id)}</p><div><span>${Number(row.previous_qty).toLocaleString()} → ${Number(row.new_qty).toLocaleString()}</span><b>${Number(row.adjusted_qty)>0?'+':''}${Number(row.adjusted_qty).toLocaleString()}</b></div><small>เหตุผล: ${esc(row.change_reason||'บันทึกครั้งแรก')}</small></article>`).join(''):'<div class="sc-empty">ยังไม่มีประวัติการแก้ไข</div>'}</div><div class="row"><button class="btn btn-primary" data-close-history>ปิด</button></div></div></div>`;modal.querySelector('[data-close-history]').onclick=()=>modal.innerHTML='';}catch(error){modal.innerHTML='';await SLF.components.alertModal('โหลดประวัติไม่สำเร็จ',error.message,'error');}
  }
  function totalFromLots(item,lots){ return lots.reduce((s,l)=>s+lotTotal(item,l),0); }

  function queueRows(){
    const q=normalizeSearch(state.queueSearch);
    const matches=activeItems().filter(i=>!q||searchText(i).includes(q));
    if(!matches.length) return '<div class="sc-empty sc-queue-empty">ไม่พบรายการที่ค้นหา</div>';
    return matches.map(i=>{
      const idx=state.items.indexOf(i);
      const c=countFor(i);
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
    return normalizeSearch([item.code,item.name].filter(Boolean).join(' '));
  }

  function progressView(){
    const scoped=activeItems();
    const statuses=['done','review','missing','pending'];
    const nums=Object.fromEntries(statuses.map(s=>[s,scoped.filter(i=>countFor(i).status===s).length]));
    const filtered=scoped.filter(i=>state.progressFilter==='all'||!state.progressFilter||countFor(i).status===state.progressFilter);
    return `<div class="sc-progress-view">
      <div class="sc-stat-grid">
        <button data-filter="all"><strong>${scoped.length}</strong><span>ทั้งหมด</span></button>
        <button data-filter="done" class="done"><strong>${nums.done}</strong><span>นับแล้ว</span></button>
        <button data-filter="review" class="review"><strong>${nums.review}</strong><span>ต้องตรวจสอบ</span></button>
        <button data-filter="missing" class="missing"><strong>${nums.missing}</strong><span>ไม่พบสินค้า</span></button>
        <button data-filter="pending"><strong>${nums.pending}</strong><span>ยังไม่ได้นับ</span></button>
      </div>
      <article class="sc-card">
        <div class="sc-card-head"><span class="sc-icon alt">≡</span><div><h3>รายการตรวจนับ</h3><p>มูลค่ารวม ${formatMoney(scoped.reduce((sum,item)=>sum+valueFor(item),0))} · แตะรายการเพื่อกลับไปแก้ไขข้อมูล</p></div></div>
        <div class="sc-result-list">${filtered.map(i=>{const c=countFor(i);return `<button data-open-id="${esc(itemKey(i))}"><span class="sc-status-dot ${c.status}">${c.status==='done'?'✓':c.status==='review'?'!':c.status==='missing'?'−':'○'}</span><span><strong>${esc(i.name)}</strong><small>${esc(i.code)} · ${esc(i.location)}</small></span><span class="sc-result-total">${totalFor(i).toLocaleString()} ${esc(i.baseUnit)}<small>${formatMoney(valueFor(i))} · ${statusLabel(c.status)}</small></span></button>`}).join('')}</div>
      </article>
    </div>`;
  }

  function bindCommon(){
    const appNav=document.querySelector('.app-nav');
    rootEl.querySelector('[data-mobile-menu]')?.addEventListener('click',event=>{event.stopPropagation();appNav?.classList.toggle('is-mobile-open');if(appNav?.classList.contains('is-mobile-open'))setTimeout(()=>document.addEventListener('click',outside=>{if(!appNav.contains(outside.target))appNav.classList.remove('is-mobile-open');},{once:true}),0);});
    rootEl.querySelector('[data-mobile-progress]')?.addEventListener('click',async()=>{if(state.view==='count'&&currentLock?.acquired){const item=state.items[state.countIndex];await SLF.auth.releaseCountLock(workspace.department.id,item.itemId||item.code).catch(()=>{});currentLock=null;clearInterval(lockTimer);}state.view=state.view==='progress'?'count':'progress';saveState();renderShell();});
    rootEl.querySelector('[data-mobile-count]')?.addEventListener('click',()=>{state.view='count';saveState();renderShell();});
    appNav?.querySelectorAll('.app-nav-item').forEach(button=>button.addEventListener('click',()=>appNav.classList.remove('is-mobile-open'),{once:true}));
    rootEl.querySelectorAll('.sc-tabs button').forEach(b=>b.onclick=async()=>{
      if(state.view==='count'&&b.dataset.view!=='count'&&currentLock?.acquired){const item=state.items[state.countIndex];await SLF.auth.releaseCountLock(workspace.department.id,item.itemId||item.code).catch(()=>{});currentLock=null;clearInterval(lockTimer);}
      state.view=b.dataset.view;
      saveState();renderShell();
    });
  }
  function bindCount(){
    if(!rootEl.querySelector('.sc-count-card')) return;
    acquireCurrentLock();
    const queue=rootEl.querySelector('.sc-queue'),openQueue=()=>{queue?.classList.add('is-open');document.body.classList.add('sc-queue-open');setTimeout(()=>rootEl.querySelector('#scQueueSearch')?.focus(),80);},closeQueue=()=>{queue?.classList.remove('is-open');document.body.classList.remove('sc-queue-open');};
    rootEl.querySelector('[data-mobile-queue]')?.addEventListener('click',openQueue);
    rootEl.querySelectorAll('[data-close-queue]').forEach(button=>button.addEventListener('click',closeQueue));
    const bindQueueRows=()=>rootEl.querySelectorAll('.sc-queue-row').forEach(b=>b.onclick=async()=>{
        const current=state.items[state.countIndex];
        putDraft(readCurrentLots());
        if(currentLock?.acquired)await SLF.auth.releaseCountLock(workspace.department.id,current.itemId||current.code).catch(()=>{});
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
    rootEl.querySelectorAll('[data-request-edit]').forEach(button=>button.onclick=()=>{
      const card=button.closest('.sc-lot-card'),label=card.querySelector('.sc-edit-reason label'),reason=card.querySelector('[data-edit-reason]');
      button.hidden=true;label.hidden=false;reason.focus();
      card.querySelector('[data-submit-edit]').onclick=()=>submitLotEditRequest(card);
    });
    rootEl.querySelectorAll('[data-view-lot-history]').forEach(button=>button.onclick=()=>showLotHistory(button.closest('.sc-lot-card')));
    rootEl.querySelector('#scAddLot').onclick=()=>{const draft=readCurrentLots(),nextGroup=Math.max(0,...draft.map(l=>Number(l.entryGroup)||0))+1;draft.push({entryGroup:nextGroup,lot:'',exp:'',qty:{}});putDraft(draft);renderShell();};
    rootEl.querySelectorAll('[data-remove-lot]').forEach(b=>b.onclick=()=>{const draft=readCurrentLots();draft.splice(Number(b.dataset.removeLot),1);putDraft(draft);renderShell();});
    rootEl.querySelector('#scSaveNext').onclick=async()=>{if(await saveCurrent('done'))goNext();};
    rootEl.querySelector('#scReview').onclick=async()=>{if(await saveCurrent('review'))goNext();};
    rootEl.querySelector('#scMissing').onclick=async()=>{if(await saveCurrent('missing'))goNext();};
  }

  async function acquireCurrentLock(){
    clearInterval(lockTimer);const item=state.items[state.countIndex],banner=rootEl.querySelector('#scCountLock');if(!item||!banner)return;
    const apply=async()=>{try{currentLock=await SLF.auth.acquireCountLock(workspace.department.id,item.itemId||item.code);const mine=currentLock?.acquired,name=currentLock?.locked_by_name||userProfile?.full_name||authSession?.user?.email||'ผู้ใช้งาน';banner.classList.remove('is-warning');banner.classList.toggle('is-locked',!mine);banner.innerHTML=mine?`<span>✍️</span><strong>คุณ (${esc(name)}) กำลังตรวจนับรายการนี้</strong>`:`<span>🔒</span><strong>${esc(name)} กำลังตรวจนับรายการนี้</strong>`;rootEl.querySelectorAll('.sc-count-card input,.sc-count-card button').forEach(el=>{const card=el.closest('.sc-lot-card'),ownerLocked=el.hasAttribute('data-owner-locked')&&card?.dataset.editing!=='true';el.disabled=!mine||ownerLocked;});}catch(error){currentLock=null;const detail=lockErrorMessage(error);banner.classList.remove('is-warning');banner.classList.add('is-locked');banner.innerHTML=`<span>⚠️</span><span><strong>ยังเริ่มนับไม่ได้</strong><small>${esc(detail)}</small></span><button type="button" class="btn" data-retry-lock>ลองตรวจสอบอีกครั้ง</button>`;rootEl.querySelectorAll('.sc-count-card input,.sc-count-card button').forEach(el=>{el.disabled=!el.hasAttribute('data-retry-lock');});banner.querySelector('[data-retry-lock]').onclick=apply;console.warn('Count lock acquisition failed',error);}};
    await apply();lockTimer=setInterval(apply,30000);
  }
  function lockErrorMessage(error){
    const message=String(error?.message||'');
    if(/locked_by|lock_expires_at|column/i.test(message))return 'ฐานข้อมูล Lock ยังไม่ครบ กรุณารัน SQL V5 ล่าสุด';
    if(/function|schema cache|PGRST202/i.test(message))return 'ยังไม่พบระบบจองสิทธิ์ กรุณารัน SQL V5 และรีโหลด Schema';
    if(/Item is not assigned/i.test(message))return 'หน่วยงานนี้เลือกนับเฉพาะรายการที่ผูก และรายการนี้ไม่ได้อยู่ในรายการที่อนุญาต';
    if(/Item not found in current organization/i.test(message))return 'ไม่พบรายการนี้ในโรงพยาบาลปัจจุบัน';
    if(/access denied|permission/i.test(message))return 'บัญชีนี้ไม่มีสิทธิ์ในหน่วยงานปัจจุบัน';
    return 'เชื่อมต่อระบบจองสิทธิ์ไม่สำเร็จ กรุณาลองอีกครั้ง';
  }

  function goNext(){
    const active=activeItems(), current=state.items[state.countIndex], pos=active.indexOf(current);
    if(pos<active.length-1) state.countIndex=state.items.indexOf(active[pos+1]);
    else state.view='progress';
    saveState();renderShell();
  }
  function readCurrentLots(){
    return [...rootEl.querySelectorAll('.sc-lot-card')].map(card=>{
      const old=countFor(state.items[state.countIndex]).lots[Number(card.dataset.lotIndex)]||{};
      const qty={};
      card.querySelectorAll('[data-qty]').forEach(i=>qty[i.dataset.qty]=Number(i.value)||0);
      return {...old,lot:card.querySelector('[data-field="lot"]').value.trim(),exp:card.querySelector('[data-field="exp"]').value,qty,editReason:card.querySelector('[data-edit-reason]')?.value.trim()||old.editReason||''};
    });
  }
  function putDraft(lots){
    const item=state.items[state.countIndex], old=countFor(item);
    state.counts[itemKey(item)]={...old,lots};saveState();
  }
  async function saveCurrent(status){
    const item=state.items[state.countIndex];
    const lots=readCurrentLots(),note=rootEl.querySelector('#scCountNote').value.trim();
    if(status!=='missing'){
      const invalid=lots.findIndex(lot=>!lot.lot||!lot.exp||lotTotal(item,lot)<=0);if(invalid>=0){await SLF.components.alertModal('ข้อมูล LOT ยังไม่ครบ',`LOT ${invalid+1}: กรุณาระบุเลข LOT, EXP และจำนวนอย่างน้อย 1 หน่วยบรรจุ`,'warning');return false;}
      const seen=new Map();for(let i=0;i<lots.length;i++){const key=`${lots[i].lot.trim().toLowerCase()}\u0000${lots[i].exp.trim()}`;if(seen.has(key)){await SLF.components.alertModal('พบ LOT และ EXP ซ้ำ',`ข้อมูลนี้มีอยู่แล้วใน LOT ${seen.get(key)+1} กรุณาแก้ไขจำนวนในรายการเดิม`,'warning');lots.splice(i,1);putDraft(lots);renderShell();return false;}seen.set(key,i);}
    }
    try{await SLF.auth.saveCount(workspace.department.id,item.itemId||item.code,status,status==='missing'?[]:lots,note,userProfile?.full_name||state.session.counter||'',item.packages);state.counts[itemKey(item)]={status,lots:status==='missing'?[]:lots,note,counterName:userProfile?.full_name||state.session.counter||''};saveState();currentLock=null;return true;}catch(error){await SLF.components.alertModal('บันทึกข้อมูลไม่สำเร็จ',error.message||'กรุณาลองใหม่อีกครั้ง','error');return false;}
  }
  function updateTotals(){
    const item=state.items[state.countIndex], lots=readCurrentLots();
    rootEl.querySelectorAll('[data-subtotal]').forEach((el,idx)=>el.textContent=`${lotTotal(item,lots[idx]).toLocaleString()} ${item.baseUnit}`);
    rootEl.querySelector('#scGrandTotal').innerHTML=`${totalFromLots(item,lots).toLocaleString()} <small>${esc(item.baseUnit)}</small>`;
    rootEl.querySelector('#scGrandValue').textContent=`มูลค่า ${formatMoney(totalFromLots(item,lots)*(Number(item.unitPrice)||0))}`;
  }
  function bindProgress(){
    rootEl.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.progressFilter=b.dataset.filter;renderShell();});
    rootEl.querySelectorAll('[data-open-id]').forEach(b=>b.onclick=()=>{state.countIndex=state.items.findIndex(i=>itemKey(i)===b.dataset.openId);state.view='count';renderShell();});
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
        ['ไฟล์นี้มีข้อมูลตัวอย่าง 1 แถวในทุกชีต กรุณาแก้ไขหรือลบข้อมูลตัวอย่างก่อนนำเข้า'],
        ['role รองรับเฉพาะ admin, staff, user'],
        ['อีเมลเดียวดูแลหลายหน่วยงานได้ โดยเพิ่มหลายแถวใน Users และระบุ department_code คนละค่า'],
        ['ถ้า Department_Items ว่าง หน่วยงานจะเห็น Items ทั้งหมด; ถ้ามีข้อมูล จะเห็นเฉพาะ item_id ที่ผูกไว้'],
        ['ทุกหน่วยบรรจุต้องมี stock_item_unit_id และ package_size ต้องเป็นตัวเลขมากกว่า 0'],
        ['สินค้าทุกตัวต้องมีหน่วยย่อย package_size = 1 ในชีต Packages']
      ],
      'Organizations':[
        ['organization_code','organization_name'],
        ['HOSP-BMS','โรงพยาบาลบีเอ็มเอส']
      ],
      'Departments':[
        ['organization_code','department_code','department_name'],
        ['HOSP-BMS','PHARMACY','ห้องจ่ายยา']
      ],
      'Items':[
        ['organization_code','item_id','item_code','item_name','base_unit','unit_price','barcode','category'],
        ['HOSP-BMS','10001','MED001','Paracetamol 500 mg','เม็ด',0.75,'885000000001','ยาเม็ด']
      ],
      'Packages':[
        ['organization_code','item_id','stock_item_unit_id','package_name','package_size','barcode'],
        ['HOSP-BMS','10001','50000','เม็ด',1,'885000000001'],
        ['HOSP-BMS','10001','50001','กล่อง',100,'885000000101']
      ],
      'Department_Items':[
        ['organization_code','department_code','item_id','location'],
        ['HOSP-BMS','PHARMACY','10001','ตู้ A · ชั้น 1']
      ],
      'Users':[
        ['email','organization_code','department_code','role'],
        ['pharmacist@example.com','HOSP-BMS','PHARMACY','admin']
      ]
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
  function valueOf(row,...keys){for(const key of keys){const value=row[normalizeHeader(key)];if(value!=null&&value!=='')return String(value);}return '';}
  function importErrorMessage(error){
    const detail=String(error?.message||error?.details||error||'ไม่ทราบสาเหตุ');
    if(/Item conflict:/i.test(detail))return `ข้อมูล Items ชนกันภายในโรงพยาบาลเดียวกัน — ${detail.replace('Item conflict:','')} กรุณาตรวจสอบว่า item_id และ item_code ระบุรายการเดียวกัน`;
    if(/column .*item_id|column .*stock_item_unit_id|column .*is_explicit|schema cache/i.test(detail))return `ฐานข้อมูลยังไม่รองรับ Template รุ่นใหม่ กรุณารัน stock-count-v3-item-ids.sql — ${detail}`;
    if(/row-level security|permission denied|42501/i.test(detail))return `บัญชีนี้ไม่มีสิทธิ์ Admin สำหรับนำเข้าข้อมูล — ${detail}`;
    if(/Department not found/i.test(detail))return `ไม่พบ department_code ที่ระบุใน Sheet Users — ${detail}`;
    return `นำเข้าไม่สำเร็จ — ${detail}`;
  }
  function prepareMasterWorkbook(wb,targetWorkspace){
    const activeWorkspace=targetWorkspace||workspace;
    const organizationCode=String(activeWorkspace.organization.code||'').trim().toUpperCase();
    const departmentCode=String(activeWorkspace.department.code||'').trim().toUpperCase();
    const belongsToOrganization=row=>{const code=valueOf(row,'organization_code').toUpperCase();return !code||code===organizationCode;};
    const belongsToDepartment=row=>{const code=valueOf(row,'department_code').toUpperCase();return !code||code===departmentCode;};
    const itemRows=rowsFromSheet(wb,'Items').filter(belongsToOrganization);
    if(!itemRows.length)throw new Error(`ไม่พบ Items ของ organization_code ${activeWorkspace.organization.code} ในไฟล์`);
    const packageRows=rowsFromSheet(wb,'Packages').filter(belongsToOrganization);
    const departmentRows=rowsFromSheet(wb,'Department_Items').filter(row=>belongsToOrganization(row)&&belongsToDepartment(row));
    const userRows=rowsFromSheet(wb,'Users').filter(belongsToOrganization);
    const items=itemRows.map(row=>{
      const itemId=valueOf(row,'item_id');
      const code=valueOf(row,'item_code','รหัสรายการ','รหัสยา');
      const baseUnit=valueOf(row,'base_unit','หน่วยฐาน')||'หน่วย';
      const packages=packageRows.filter(p=>valueOf(p,'item_id')===itemId).map(p=>({stockItemUnitId:valueOf(p,'stock_item_unit_id'),name:valueOf(p,'package_name','หน่วยบรรจุ')||baseUnit,size:Math.max(1,Number(valueOf(p,'package_size','ขนาดบรรจุ'))||1),barcode:valueOf(p,'barcode')}));
      if(!packages.length)throw new Error(`ไม่พบ Package ของ item_id ${itemId}`);
      if(packages.some(pack=>!pack.stockItemUnitId))throw new Error(`Package ของ item_id ${itemId} ต้องมี stock_item_unit_id ทุกแถว`);
      if(new Set(packages.map(pack=>pack.stockItemUnitId)).size!==packages.length)throw new Error(`Package ของ item_id ${itemId} มี stock_item_unit_id ซ้ำกัน`);
      if(new Set(packages.map(pack=>Number(pack.size))).size!==packages.length)throw new Error(`Package ของ item_id ${itemId} มี package_size ซ้ำกัน`);
      if(!packages.some(pack=>Number(pack.size)===1))throw new Error(`Package ของ item_id ${itemId} ต้องมีหน่วยย่อย package_size = 1`);
      if(!packages.some(pack=>Number(pack.size)===1))packages.push({stockItemUnitId:'',name:baseUnit,size:1,barcode:''});
      packages.sort((a,b)=>Number(b.size)-Number(a.size));
      const dept=departmentRows.find(d=>valueOf(d,'item_id')===itemId);
      return {itemId,code,name:valueOf(row,'item_name','ชื่อรายการ','ชื่อยา'),departmentLinked:Boolean(dept),location:dept?valueOf(dept,'location','ตำแหน่ง'):'',barcode:valueOf(row,'barcode'),baseUnit,unitPrice:Math.max(0,Number(valueOf(row,'unit_price','ราคาต่อหน่วย').replace(/,/g,''))||0),category:valueOf(row,'category','ประเภท'),packages,lots:[]};
    }).filter(item=>item.itemId&&item.code&&item.name);
    if(!items.length)throw new Error('ไม่พบข้อมูล Item ที่สมบูรณ์');
    const itemIdCodes=new Map();
    items.forEach(item=>{
      if(itemIdCodes.has(item.itemId)&&itemIdCodes.get(item.itemId)!==item.code)throw new Error(`Item conflict: item_id ${item.itemId} is assigned to both ${itemIdCodes.get(item.itemId)} and ${item.code} in the import file`);
      itemIdCodes.set(item.itemId,item.code);
    });
    const payload={items,itemRows,packageRows,departmentRows,organizationRows:rowsFromSheet(wb,'Organizations').filter(row=>valueOf(row,'organization_code').toUpperCase()===organizationCode),departments:rowsFromSheet(wb,'Departments').filter(belongsToOrganization),users:userRows};
    return {items,payload};
  }
  function showMasterImportPreview(prepared){
    const modalRoot=document.getElementById('modalRoot');
    const packageCount=prepared.items.reduce((sum,item)=>sum+item.packages.length,0);
    const linkedCount=prepared.items.filter(item=>item.departmentLinked).length;
    modalRoot.innerHTML=`<div class="overlay"><div class="modal sc-import-preview-modal">
      <h3>ตรวจสอบข้อมูลก่อนนำเข้า</h3>
      <p>ข้อมูลจะถูกนำเข้าโรงพยาบาล <strong>${esc(workspace.organization.name)}</strong> · หน่วยงาน <strong>${esc(workspace.department.name)}</strong></p>
      <div class="sc-preview-summary">
        <div><strong>${prepared.items.length}</strong><span>Items</span></div>
        <div><strong>${packageCount}</strong><span>Packages</span></div>
        <div><strong>${linkedCount}</strong><span>รายการที่ผูกหน่วยงาน</span></div>
        <div><strong>${prepared.payload?.users?.length||0}</strong><span>สิทธิ์ผู้ใช้</span></div>
      </div>
      <div class="sc-preview-table-wrap"><table class="data"><thead><tr><th>item_id</th><th>item_code</th><th>item_name</th><th>หน่วย</th><th>ราคาต่อหน่วย</th><th>Package</th><th>ผูกหน่วยงาน</th></tr></thead><tbody>
        ${prepared.items.map(item=>`<tr><td>${esc(item.itemId)}</td><td>${esc(item.code)}</td><td>${esc(item.name)}</td><td>${esc(item.baseUnit)}</td><td>${formatMoney(item.unitPrice)}</td><td>${item.packages.length}</td><td>${item.departmentLinked?'ใช่':'ไม่'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="sc-import-progress" id="scImportProgress" hidden><div><span>เตรียมนำเข้าข้อมูล</span><b>0%</b></div><div class="sc-import-progress-track"><i></i></div></div>
      <div class="sc-auth-error" id="scImportModalError"></div><div class="row"><button class="btn" id="scCancelImport">ยกเลิก</button><button class="btn btn-primary" id="scConfirmImport">ยืนยันนำเข้าข้อมูล</button></div>
    </div></div>`;
    modalRoot.querySelector('#scCancelImport').onclick=()=>{modalRoot.innerHTML='';const input=rootEl.querySelector('#scMasterFile');if(input)input.value='';};
    modalRoot.querySelector('#scConfirmImport').onclick=async()=>{
      const confirmButton=modalRoot.querySelector('#scConfirmImport'),cancelButton=modalRoot.querySelector('#scCancelImport'),progressEl=modalRoot.querySelector('#scImportProgress'),errorEl=modalRoot.querySelector('#scImportModalError');confirmButton.disabled=true;cancelButton.disabled=true;confirmButton.textContent='กำลังนำเข้า...';progressEl.hidden=false;errorEl.textContent='';
      const updateProgress=({percent,label})=>{progressEl.querySelector('span').textContent=label;progressEl.querySelector('b').textContent=`${percent}%`;progressEl.querySelector('i').style.width=`${percent}%`;};
      try{
        if(prepared.payload&&SLF.auth.importMasterData)await SLF.auth.importMasterData(workspace.organization.id,workspace.department.id,prepared.payload,updateProgress);
        await new Promise(resolve=>setTimeout(resolve,300));
        modalRoot.innerHTML='';state.items=prepared.items;state.counts={};state.search='';saveState();renderShell();
      }catch(error){
        console.error('Master data import failed',error);confirmButton.disabled=false;cancelButton.disabled=false;confirmButton.textContent='ลองนำเข้าอีกครั้ง';errorEl.textContent=importErrorMessage(error);progressEl.classList.add('is-error');progressEl.querySelector('span').textContent='นำเข้าไม่สำเร็จ';
      }
    };
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
          showMasterImportPreview(prepareMasterWorkbook(wb));
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
          price:findCol(headers,['unitprice','unit_price','ราคาต่อหน่วย','ราคา']),
          lot:findCol(headers,['lot','ล็อต']),
          exp:findCol(headers,['exp','วันหมดอายุ','expire'])
        };
        if(cols.code<0||cols.name<0) throw new Error('missing columns');
        const grouped=new Map();
        rows.slice(headerIndex+1).forEach(r=>{
          const code=String(r[cols.code]||'').trim(), name=String(r[cols.name]||'').trim();
          if(!code||!name)return;
          if(!grouped.has(code)) grouped.set(code,{code,name,location:cols.location>=0?String(r[cols.location]||'ยังไม่ระบุตำแหน่ง'):'ยังไม่ระบุตำแหน่ง',barcode:cols.barcode>=0?String(r[cols.barcode]||''):'',baseUnit:cols.unit>=0?String(r[cols.unit]||'หน่วย'):'หน่วย',unitPrice:cols.price>=0?Math.max(0,Number(String(r[cols.price]||0).replace(/,/g,''))||0):0,packages:[],lots:[]});
          const item=grouped.get(code), size=Math.max(1,Number(r[cols.size])||1), unit=cols.unit>=0?String(r[cols.unit]||item.baseUnit):item.baseUnit;
          if(!item.packages.some(p=>p.size===size))item.packages.push({name:unit,size});
          const lot=cols.lot>=0?String(r[cols.lot]||'').trim():'';
          if(lot&&!item.lots.some(l=>l.lot===lot))item.lots.push({lot,exp:cols.exp>=0?excelDate(r[cols.exp]):''});
        });
        const items=[...grouped.values()].map(item=>{if(!item.packages.some(pack=>Number(pack.size)===1))item.packages.push({name:item.baseUnit||'หน่วย',size:1});item.packages.sort((a,b)=>Number(b.size)-Number(a.size));return item;});
        if(!items.length)throw new Error('ไม่พบข้อมูล Item ที่สมบูรณ์');
        showMasterImportPreview({items,payload:null});
      }catch(err){
        status.textContent=String(err?.message||'').includes('missing columns')?'ไม่พบคอลัมน์รหัสยาและชื่อยา กรุณาตรวจหัวตาราง':importErrorMessage(err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  SLF.pages = SLF.pages || {};
  SLF.pages.stockCount = { render, prepareMasterWorkbook, downloadMasterTemplate, chooseWorkspace:renderWorkspacePicker };
})();

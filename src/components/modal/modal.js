window.SLF = window.SLF || {};

(function(){
  function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function bindKeys(root,onConfirm,allowEscape=true){
    const handler=event=>{if(event.key==='Enter'){event.preventDefault();onConfirm();}else if(allowEscape&&event.key==='Escape'){event.preventDefault();root.innerHTML='';document.removeEventListener('keydown',handler);}};
    document.addEventListener('keydown',handler,{once:false});return()=>document.removeEventListener('keydown',handler);
  }
  function confirmModal(title, body, onYes, yesLabel){
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="overlay">
        <div class="modal system-modal system-modal-confirm" role="dialog" aria-modal="true">
          <div class="system-modal-icon">⚠️</div><span class="system-modal-kicker">ยืนยันการทำรายการ</span><h3>${title}</h3>
          <p>${body}</p>
          <div class="row">
            <button class="btn" id="mCancel">ยกเลิก</button>
            <button class="btn btn-danger" id="mYes" style="border-color:var(--danger);background:var(--danger-tint);color:var(--danger)">${yesLabel||'ยืนยัน'}</button>
          </div>
        </div>
      </div>`;
    const close=()=>{cleanup();root.innerHTML='';},yes=()=>{cleanup();root.innerHTML='';onYes();},cleanup=bindKeys(root,yes);
    document.getElementById('mCancel').onclick = close;
    document.getElementById('mYes').onclick = yes;
    document.getElementById('mCancel').focus();
  }

  function alertModal(title,message,type='warning',buttonLabel='ตกลง'){
    const root=document.getElementById('modalRoot'),icons={warning:'⚠️',error:'⛔',success:'✅',info:'ℹ️',pending:'⏳'},selected=icons[type]?type:'warning';
    return new Promise(resolve=>{
      root.innerHTML=`<div class="overlay"><div class="modal system-modal system-modal-${selected}" role="alertdialog" aria-modal="true"><div class="system-modal-icon">${icons[selected]}</div><span class="system-modal-kicker">${selected==='error'?'เกิดข้อผิดพลาด':selected==='success'?'ดำเนินการสำเร็จ':selected==='pending'?'กำลังรออนุมัติ':selected==='info'?'ข้อมูล':'กรุณาตรวจสอบ'}</span><h3>${esc(title)}</h3><p>${esc(message)}</p><div class="row"><button class="btn btn-primary" id="mAlertOk">${esc(buttonLabel)}</button></div></div></div>`;
      const finish=()=>{cleanup();root.innerHTML='';resolve();},cleanup=bindKeys(root,finish,false),button=root.querySelector('#mAlertOk');button.onclick=finish;button.focus();
    });
  }

  SLF.components = SLF.components || {};
  SLF.components.confirmModal = confirmModal;
  SLF.components.alertModal = alertModal;
})();

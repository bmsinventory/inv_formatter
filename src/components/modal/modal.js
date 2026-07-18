window.SLF = window.SLF || {};

(function(){
  function confirmModal(title, body, onYes, yesLabel){
    const root = document.getElementById('modalRoot');
    root.innerHTML = `
      <div class="overlay">
        <div class="modal">
          <h3>${title}</h3>
          <p>${body}</p>
          <div class="row">
            <button class="btn" id="mCancel">ยกเลิก</button>
            <button class="btn btn-danger" id="mYes" style="border-color:var(--danger);background:var(--danger-tint);color:var(--danger)">${yesLabel||'ยืนยัน'}</button>
          </div>
        </div>
      </div>`;
    document.getElementById('mCancel').onclick = ()=> root.innerHTML='';
    document.getElementById('mYes').onclick = ()=>{ root.innerHTML=''; onYes(); };
  }

  SLF.components = SLF.components || {};
  SLF.components.confirmModal = confirmModal;
})();

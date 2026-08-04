window.SLF = window.SLF || {};

(function(){
  const DEVICE_KEY = 'bms-stock-count-device-id';
  const cfg = SLF.supabaseConfig || {};

  function deviceId(){
    let id='';
    try{id=localStorage.getItem(DEVICE_KEY)||'';}catch(e){}
    if(!id){
      id=(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      try{localStorage.setItem(DEVICE_KEY,id);}catch(e){}
    }
    return id;
  }

  function headers(extra){
    return Object.assign({apikey:cfg.anonKey,Authorization:`Bearer ${cfg.anonKey}`},extra||{});
  }
  function endpoint(query){
    return `${cfg.url}/rest/v1/${cfg.stockCountTable}${query||''}`;
  }
  function enabled(){return Boolean(cfg.url&&cfg.anonKey&&cfg.stockCountTable&&window.fetch);}

  async function pull(){
    if(!enabled()) return null;
    const id=deviceId();
    const response=await fetch(endpoint(`?device_id=eq.${encodeURIComponent(id)}&select=payload,updated_at&limit=1`),{headers:headers()});
    if(!response.ok) throw new Error(`Supabase pull failed (${response.status})`);
    const rows=await response.json();
    return rows[0]||null;
  }

  async function push(payload){
    if(!enabled()) return null;
    const response=await fetch(endpoint('?on_conflict=device_id'),{
      method:'POST',
      headers:headers({'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'}),
      body:JSON.stringify({device_id:deviceId(),payload,updated_at:new Date().toISOString()})
    });
    if(!response.ok) throw new Error(`Supabase push failed (${response.status})`);
    return true;
  }

  SLF.stockCountSync={deviceId,pull,push,enabled};
})();

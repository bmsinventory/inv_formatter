window.SLF = window.SLF || {};

(function(){
  const cfg=SLF.supabaseConfig||{};
  let client=null;

  function getClient(){
    if(!client&&window.supabase&&cfg.url&&cfg.anonKey) client=window.supabase.createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    return client;
  }
  async function session(){const c=getClient();if(!c)return null;const {data,error}=await c.auth.getSession();if(error)throw error;return data.session;}
  async function googleOAuth(){
    const c=getClient();if(!c)throw new Error('Supabase ยังไม่พร้อม');
    return c.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.href.split('#')[0],queryParams:{prompt:'select_account'}}});
  }
  async function googleIdToken(credential){
    const c=getClient();if(!c)throw new Error('Supabase ยังไม่พร้อม');
    const {data,error}=await c.auth.signInWithIdToken({provider:'google',token:credential});if(error)throw error;return data;
  }
  async function signOut(){const c=getClient();if(c)await c.auth.signOut();}
  function onChange(callback){const c=getClient();return c?c.auth.onAuthStateChange((_event,value)=>callback(value)):null;}
  async function organizations(){
    const c=getClient();const {data,error}=await c.from('organizations').select('id,name,code,departments(id,name,code)').eq('is_active',true).order('name');
    if(error)throw error;return data||[];
  }
  async function joinDepartment(user,organizationId,departmentId){
    const c=getClient();
    const profile={id:user.id,email:user.email||'',full_name:user.user_metadata?.full_name||user.user_metadata?.name||user.email||'',avatar_url:user.user_metadata?.avatar_url||user.user_metadata?.picture||null,last_login_at:new Date().toISOString()};
    let result=await c.from('profiles').upsert(profile,{onConflict:'id'});if(result.error)throw result.error;
    result=await c.rpc('join_stock_department',{target_department_id:departmentId});if(result.error)throw result.error;
    localStorage.setItem('bms-stock-workspace',JSON.stringify({organizationId,departmentId}));
    return result.data||'user';
  }
  async function memberships(userId){
    const c=getClient();const {data,error}=await c.from('department_members').select('role,department:departments(id,name,code,organization:organizations(id,name,code))').eq('user_id',userId).eq('status','active');
    if(error)throw error;return data||[];
  }
  async function profile(userId){const c=getClient();const {data,error}=await c.from('profiles').select('id,email,full_name,avatar_url').eq('id',userId).maybeSingle();if(error)throw error;return data;}
  async function departmentItems(departmentId){
    const c=getClient();const {data,error}=await c.from('department_items').select('location,status,item:items(id,code,name,base_unit,barcode,category,packages:item_packages(id,name,size,barcode))').eq('department_id',departmentId).order('created_at');
    if(error)throw error;return (data||[]).filter(row=>row.item).map(row=>({code:row.item.code,name:row.item.name,baseUnit:row.item.base_unit,barcode:row.item.barcode||'',category:row.item.category||'',location:row.location||'',packages:(row.item.packages||[]).map(pack=>({name:pack.name,size:Number(pack.size),barcode:pack.barcode||''})),lots:[]}));
  }
  async function countResults(departmentId){
    const c=getClient();const {data,error}=await c.from('opening_stock_counts').select('status,note,counter_name,department_item:department_items!inner(department_id,item:items(code)),entries:opening_stock_entries(lot,exp,qty)').eq('department_item.department_id',departmentId);
    if(error)throw error;const counts={};(data||[]).forEach(row=>{const code=row.department_item?.item?.code;if(code)counts[code]={status:row.status,note:row.note||'',counterName:row.counter_name||'',lots:(row.entries||[]).map(entry=>({lot:entry.lot||'',exp:entry.exp||'',qty:entry.qty||{}}))};});return counts;
  }
  async function saveCount(departmentId,itemCode,status,lots,note,counterName,packages){
    const c=getClient();
    let result=await c.from('department_items').select('id,item:items!inner(code)').eq('department_id',departmentId).eq('item.code',itemCode).maybeSingle();if(result.error)throw result.error;if(!result.data)throw new Error('Item not found');
    result=await c.from('opening_stock_counts').upsert({department_item_id:result.data.id,status,note:note||'',counted_by:(await session()).user.id,counter_name:counterName||'',completed_at:status==='pending'?null:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'department_item_id'}).select('id').single();if(result.error)throw result.error;
    const countId=result.data.id;let deletion=await c.from('opening_stock_entries').delete().eq('count_id',countId);if(deletion.error)throw deletion.error;
    const entries=(lots||[]).map(lot=>({count_id:countId,lot:lot.lot||'',exp:lot.exp||'',qty:lot.qty||{},base_quantity:(packages||[]).reduce((sum,pack)=>sum+(Number(lot.qty&&lot.qty[pack.size])||0)*Number(pack.size||1),0)}));
    if(entries.length){const insertion=await c.from('opening_stock_entries').insert(entries);if(insertion.error)throw insertion.error;}
  }
  function savedWorkspace(){try{return JSON.parse(localStorage.getItem('bms-stock-workspace'))||null;}catch(e){return null;}}

  async function importMasterData(organizationId,departmentId,payload){
    const c=getClient();
    const itemPayload=payload.items.map(item=>({organization_id:organizationId,code:item.code,name:item.name,base_unit:item.baseUnit,barcode:item.barcode||null,category:item.category||null,is_active:true}));
    let result=await c.from('items').upsert(itemPayload,{onConflict:'organization_id,code'}).select('id,code');if(result.error)throw result.error;
    const ids=new Map(result.data.map(item=>[item.code,item.id]));
    const packages=payload.items.flatMap(item=>item.packages.map(pack=>({item_id:ids.get(item.code),name:pack.name,size:Number(pack.size)||1,barcode:pack.barcode||null}))).filter(row=>row.item_id);
    if(packages.length){result=await c.from('item_packages').upsert(packages,{onConflict:'item_id,name,size'});if(result.error)throw result.error;}
    const departmentItems=payload.items.map(item=>({department_id:departmentId,item_id:ids.get(item.code),location:item.location||null,status:'pending'})).filter(row=>row.item_id);
    result=await c.from('department_items').upsert(departmentItems,{onConflict:'department_id,item_id'});if(result.error)throw result.error;
    const userRules=(payload.users||[]).filter(row=>row.email).map(row=>({organization_id:organizationId,department_id:departmentId,email:String(row.email).toLowerCase(),role:['admin','staff','user'].includes(String(row.role).toLowerCase())?String(row.role).toLowerCase():'user'}));
    if(userRules.length){result=await c.from('member_access_rules').upsert(userRules,{onConflict:'department_id,email'});if(result.error)throw result.error;}
    return {items:itemPayload.length,packages:packages.length,users:userRules.length};
  }

  SLF.auth={getClient,session,googleOAuth,googleIdToken,signOut,onChange,organizations,joinDepartment,memberships,profile,departmentItems,countResults,saveCount,savedWorkspace,importMasterData};
})();

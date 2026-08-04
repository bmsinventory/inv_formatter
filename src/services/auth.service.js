window.SLF = window.SLF || {};

(function(){
  const cfg=SLF.supabaseConfig||{};
  let client=null;
  let superAdminCache=null,superAdminCacheOwner='',superAdminRequest=null;
  const requestCache=new Map();
  function cached(key,loader,ttl=30000,force=false){
    const now=Date.now(),entry=requestCache.get(key);
    if(!force&&entry&&(entry.promise||now-entry.time<ttl))return entry.promise||Promise.resolve(entry.value);
    const promise=Promise.resolve().then(loader).then(value=>{requestCache.set(key,{value,time:Date.now(),promise:null});return value;}).catch(error=>{requestCache.delete(key);throw error;});
    requestCache.set(key,{value:entry?.value,time:entry?.time||0,promise});return promise;
  }
  function invalidate(prefix){for(const key of requestCache.keys())if(!prefix||key.startsWith(prefix))requestCache.delete(key);}

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
  async function signOut(){const c=getClient();invalidate();superAdminCache=null;if(c)await c.auth.signOut();}
  function onChange(callback){const c=getClient();return c?c.auth.onAuthStateChange((_event,value)=>callback(value)):null;}
  async function organizations(){
    return cached('organizations',async()=>{const c=getClient();const {data,error}=await c.from('organizations').select('id,name,code,departments(id,name,code)').eq('is_active',true).order('name');if(error)throw error;return data||[];},60000);
  }
  async function joinDepartment(user,organizationId,departmentId){
    const c=getClient();
    const profile={id:user.id,email:user.email||'',full_name:user.user_metadata?.full_name||user.user_metadata?.name||user.email||'',avatar_url:user.user_metadata?.avatar_url||user.user_metadata?.picture||null,last_login_at:new Date().toISOString()};
    let result=await c.from('profiles').upsert(profile,{onConflict:'id'});if(result.error)throw result.error;
    result=await c.rpc('join_stock_department',{target_department_id:departmentId});if(result.error)throw result.error;
    localStorage.setItem('bms-stock-workspace',JSON.stringify({organizationId,departmentId}));
    invalidate(`memberships:${user.id}`);
    return result.data||'user';
  }
  async function memberships(userId){
    return cached(`memberships:${userId}`,async()=>{const c=getClient();const {data,error}=await c.from('department_members').select('role,department:departments(id,name,code,organization:organizations(id,name,code))').eq('user_id',userId).eq('status','active');if(error)throw error;return data||[];},30000);
  }
  async function profile(userId){return cached(`profile:${userId}`,async()=>{const c=getClient();const {data,error}=await c.from('profiles').select('id,email,full_name,avatar_url').eq('id',userId).maybeSingle();if(error)throw error;return data;},60000);}
  async function departmentItems(departmentId){
    return cached(`items:${departmentId}`,async()=>{const c=getClient();
    let result=await c.from('departments').select('organization_id').eq('id',departmentId).single();if(result.error)throw result.error;
    const organizationId=result.data.organization_id;
    const [itemResult,departmentResult]=await Promise.all([c.from('items').select('id,item_id,code,name,base_unit,unit_price,barcode,category,packages:item_packages(id,stock_item_unit_id,name,size,barcode)').eq('organization_id',organizationId).eq('is_active',true).order('created_at'),c.from('department_items').select('item_id,location,status,is_explicit').eq('department_id',departmentId)]);
    if(itemResult.error)throw itemResult.error;if(departmentResult.error)throw departmentResult.error;
    const items=itemResult.data||[],departmentRows=departmentResult.data||[];
    const departmentData=new Map(departmentRows.map(row=>[row.item_id,row]));
    const hasExplicitItems=departmentRows.some(row=>row.is_explicit);
    return items.filter(item=>!hasExplicitItems||departmentData.get(item.id)?.is_explicit).map(item=>{
      const link=departmentData.get(item.id),packages=(item.packages||[]).map(pack=>({systemId:pack.id,stockItemUnitId:pack.stock_item_unit_id||'',name:pack.name,size:Number(pack.size),barcode:pack.barcode||''}));
      if(!packages.some(pack=>Number(pack.size)===1))packages.push({stockItemUnitId:'',name:item.base_unit||'หน่วย',size:1,barcode:''});
      packages.sort((a,b)=>Number(b.size)-Number(a.size));
      return {systemId:item.id,itemId:item.item_id,code:item.code,name:item.name,baseUnit:item.base_unit,unitPrice:Number(item.unit_price)||0,barcode:item.barcode||'',category:item.category||'',location:link?.location||'',packages,lots:[]};
    });},30000);
  }
  async function countResults(departmentId){
    return cached(`counts:${departmentId}`,async()=>{const c=getClient();const {data,error}=await c.from('opening_stock_counts').select('status,note,counter_name,department_item:department_items!inner(department_id,item:items(item_id)),entries:opening_stock_entries(lot,exp,qty)').eq('department_item.department_id',departmentId);if(error)throw error;const counts={};(data||[]).forEach(row=>{const itemId=row.department_item?.item?.item_id;if(itemId)counts[itemId]={status:row.status,note:row.note||'',counterName:row.counter_name||'',lots:(row.entries||[]).map(entry=>({lot:entry.lot||'',exp:entry.exp||'',qty:entry.qty||{}}))};});return counts;},10000);
  }
  async function saveCount(departmentId,itemId,status,lots,note,counterName,packages){
    const c=getClient();
    let result=await c.from('department_items').select('id,item:items!inner(item_id)').eq('department_id',departmentId).eq('item.item_id',itemId).maybeSingle();if(result.error)throw result.error;
    if(!result.data){
      result=await c.rpc('ensure_department_item',{target_department_id:departmentId,target_source_item_id:itemId});if(result.error)throw result.error;
      result={data:{id:result.data}};
    }
    result=await c.from('opening_stock_counts').upsert({department_item_id:result.data.id,status,note:note||'',counted_by:(await session()).user.id,counter_name:counterName||'',completed_at:status==='pending'?null:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'department_item_id'}).select('id').single();if(result.error)throw result.error;
    const countId=result.data.id;let deletion=await c.from('opening_stock_entries').delete().eq('count_id',countId);if(deletion.error)throw deletion.error;
    const entries=(lots||[]).map(lot=>({count_id:countId,lot:lot.lot||'',exp:lot.exp||'',qty:lot.qty||{},base_quantity:(packages||[]).reduce((sum,pack)=>sum+(Number(lot.qty&&lot.qty[pack.size])||0)*Number(pack.size||1),0)}));
    if(entries.length){const insertion=await c.from('opening_stock_entries').insert(entries);if(insertion.error)throw insertion.error;}invalidate(`counts:${departmentId}`);invalidate('dashboard');
  }
  function savedWorkspace(){try{return JSON.parse(localStorage.getItem('bms-stock-workspace'))||null;}catch(e){return null;}}
  async function bootstrapWorkspace(organization,department){
    const c=getClient();const {data,error}=await c.rpc('bootstrap_stock_workspace',{org_code:organization.code,org_name:organization.name,dept_code:department.code,dept_name:department.name});
    if(error)throw error;const created=Array.isArray(data)?data[0]:data;
    if(created)localStorage.setItem('bms-stock-workspace',JSON.stringify({organizationId:created.organization_id,departmentId:created.department_id}));
    return created;
  }
  async function clearOrganizationData(organizationId){
    const c=getClient();const {data,error}=await c.rpc('clear_organization_inventory',{target_organization_id:organizationId});
    if(error)throw error;superAdminCache=null;invalidate();return Number(data)||0;
  }
  async function superAdminStatus(){
    const current=await session(),userId=current?.user?.id||'';return cached(`super-status:${userId}`,async()=>{const c=getClient();const {data,error}=await c.from('platform_admins').select('user_id').maybeSingle();if(error){if(error.code==='42P01'||error.code==='PGRST205')return false;throw error;}return Boolean(data);},60000);
  }
  function subscribeDepartment(departmentId,callback){
    const c=getClient();if(!c)return()=>{};let timer;
    const notify=()=>{invalidate(`counts:${departmentId}`);invalidate(`items:${departmentId}`);clearTimeout(timer);timer=setTimeout(callback,350);};
    const channel=c.channel(`stock-department-${departmentId}`).on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_counts'},notify).on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_entries'},notify).on('postgres_changes',{event:'*',schema:'public',table:'department_items',filter:`department_id=eq.${departmentId}`},notify).on('postgres_changes',{event:'*',schema:'public',table:'items'},notify).on('postgres_changes',{event:'*',schema:'public',table:'item_packages'},notify).subscribe();
    return()=>{clearTimeout(timer);c.removeChannel(channel);};
  }
  function subscribeMasterData(callback){
    const c=getClient();if(!c)return()=>{};let timer;const notify=()=>{superAdminCache=null;invalidate('organizations');clearTimeout(timer);timer=setTimeout(callback,400);};
    const channel=c.channel('master-data-live').on('postgres_changes',{event:'*',schema:'public',table:'organizations'},notify).on('postgres_changes',{event:'*',schema:'public',table:'departments'},notify).on('postgres_changes',{event:'*',schema:'public',table:'items'},notify).on('postgres_changes',{event:'*',schema:'public',table:'item_packages'},notify).on('postgres_changes',{event:'*',schema:'public',table:'member_access_rules'},notify).on('postgres_changes',{event:'*',schema:'public',table:'platform_admins'},notify).subscribe();return()=>{clearTimeout(timer);c.removeChannel(channel);};
  }
  async function dashboardData(force=false){
    return cached('dashboard',async()=>{const c=getClient();const {data,error}=await c.rpc('stock_count_dashboard');if(error)throw error;return data||[];},10000,force);
  }
  function subscribeDashboard(callback){
    const c=getClient();if(!c)return()=>{};let timer;const notify=()=>{invalidate('dashboard');clearTimeout(timer);timer=setTimeout(callback,450);};
    const channel=c.channel('dashboard-live').on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_counts'},notify).on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_entries'},notify).subscribe();return()=>{clearTimeout(timer);c.removeChannel(channel);};
  }
  async function superAdminData(force=false){
    const currentSession=await session(),owner=currentSession?.user?.id||'';
    if(!force&&superAdminCache&&superAdminCacheOwner===owner)return superAdminCache;
    if(!force&&superAdminRequest&&superAdminCacheOwner===owner)return superAdminRequest;
    superAdminCacheOwner=owner;
    superAdminRequest=(async()=>{
    const c=getClient();
    const [organizations,departments,items,packages,accessRules,platformAdmins]=await Promise.all([
      c.from('organizations').select('id,code,name,is_active').order('name'),
      c.from('departments').select('id,organization_id,code,name,is_active').order('name'),
      c.from('items').select('id,organization_id,item_id,code,name,base_unit,unit_price,barcode,category,is_active').order('name'),
      c.from('item_packages').select('id,item_id,stock_item_unit_id,name,size,barcode').order('name'),
      c.from('member_access_rules').select('id,organization_id,department_id,email,role').order('email'),
      c.from('platform_admins').select('user_id,created_at').order('created_at')
    ]);
    const failed=[organizations,departments,items,packages,accessRules,platformAdmins].find(result=>result.error);if(failed)throw failed.error;
    const adminIds=(platformAdmins.data||[]).map(row=>row.user_id),adminProfiles=adminIds.length?await c.from('profiles').select('id,email,full_name').in('id',adminIds):{data:[],error:null};if(adminProfiles.error)throw adminProfiles.error;
    const profilesById=new Map((adminProfiles.data||[]).map(row=>[row.id,row])),superAdminRules=(platformAdmins.data||[]).map(row=>{const adminProfile=profilesById.get(row.user_id);return{id:`super:${row.user_id}`,user_id:row.user_id,organization_id:null,department_id:null,email:adminProfile?.email||row.user_id,full_name:adminProfile?.full_name||'',role:'super_admin',source:'platform_admin'};});
    superAdminCache={organizations:organizations.data||[],departments:departments.data||[],items:items.data||[],packages:packages.data||[],accessRules:[...superAdminRules,...(accessRules.data||[])]};
    return superAdminCache;
    })();
    try{return await superAdminRequest;}finally{superAdminRequest=null;}
  }
  const adminTables={organizations:'organizations',departments:'departments',items:'items',packages:'item_packages',users:'member_access_rules'};
  async function superAdminSave(entity,id,values){
    const table=adminTables[entity];if(!table)throw new Error('Unsupported master-data entity');
    const c=getClient(),query=id?c.from(table).update(values).eq('id',id):c.from(table).insert(values);
    const {data,error}=await query.select().single();if(error)throw error;superAdminCache=null;invalidate();return data;
  }
  async function superAdminDelete(entity,id){
    const table=adminTables[entity];if(!table)throw new Error('Unsupported master-data entity');
    const c=getClient();const {error}=await c.from(table).delete().eq('id',id);if(error)throw error;
    superAdminCache=null;invalidate();
  }

  async function importMasterData(organizationId,departmentId,payload){
    const c=getClient();
    const itemPayload=payload.items.map(item=>({organization_id:organizationId,item_id:item.itemId,code:item.code,name:item.name,base_unit:item.baseUnit,unit_price:Number(item.unitPrice)||0,barcode:item.barcode||null,category:item.category||null,is_active:true}));
    let result=await c.from('items').select('id,item_id,code,name').eq('organization_id',organizationId);if(result.error)throw result.error;
    const existingByItemId=new Map((result.data||[]).map(item=>[String(item.item_id),item]));
    const existingByCodeName=new Map((result.data||[]).map(item=>[`${String(item.code)}\u0000${String(item.name||'')}`,item]));
    const incomingCodeNameCounts=new Map();
    itemPayload.forEach(item=>{const key=`${String(item.code)}\u0000${String(item.name)}`;incomingCodeNameCounts.set(key,(incomingCodeNameCounts.get(key)||0)+1);});
    const ids=new Map();
    for(const item of itemPayload){
      const byItemId=existingByItemId.get(String(item.item_id));
      const codeNameKey=`${String(item.code)}\u0000${String(item.name)}`;
      const byCodeName=incomingCodeNameCounts.get(codeNameKey)===1?existingByCodeName.get(codeNameKey):null;
      const existing=byItemId||byCodeName;
      result=existing
        ?await c.from('items').update(item).eq('id',existing.id).select('id,item_id,code,name').single()
        :await c.from('items').insert(item).select('id,item_id,code,name').single();
      if(result.error)throw result.error;
      if(existing){existingByItemId.delete(String(existing.item_id));existingByCodeName.delete(`${String(existing.code)}\u0000${String(existing.name||'')}`);}
      ids.set(String(result.data.item_id),result.data.id);
      existingByItemId.set(String(result.data.item_id),result.data);
      existingByCodeName.set(`${String(result.data.code)}\u0000${String(result.data.name||'')}`,result.data);
    }
    const packages=payload.items.flatMap(item=>item.packages.map(pack=>({item_id:ids.get(String(item.itemId)),stock_item_unit_id:pack.stockItemUnitId||null,name:pack.name,size:Number(pack.size)||1,barcode:pack.barcode||null}))).filter(row=>row.item_id);
    if(packages.length){result=await c.from('item_packages').upsert(packages,{onConflict:'item_id,name,size'});if(result.error)throw result.error;}
    result=await c.from('department_items').update({is_explicit:false}).eq('department_id',departmentId);if(result.error)throw result.error;
    const departmentItems=payload.items.filter(item=>item.departmentLinked).map(item=>({department_id:departmentId,item_id:ids.get(String(item.itemId)),location:item.location||null,status:'pending',is_explicit:true})).filter(row=>row.item_id);
    if(departmentItems.length){result=await c.from('department_items').upsert(departmentItems,{onConflict:'department_id,item_id'});if(result.error)throw result.error;}
    result=await c.from('departments').select('id,code').eq('organization_id',organizationId);if(result.error)throw result.error;
    const departmentIds=new Map((result.data||[]).map(row=>[String(row.code).trim().toUpperCase(),row.id]));
    const userRuleMap=new Map();
    (payload.users||[]).filter(row=>row.email).forEach(row=>{
      const departmentCode=String(row.departmentcode||row.department_code||'').trim().toUpperCase();
      const targetDepartmentId=departmentCode?departmentIds.get(departmentCode):departmentId;
      if(!targetDepartmentId)throw new Error(`Department not found: ${departmentCode}`);
      const email=String(row.email).trim().toLowerCase();
      const requestedRole=String(row.role||'user').trim().toLowerCase();
      userRuleMap.set(`${targetDepartmentId}:${email}`,{organization_id:organizationId,department_id:targetDepartmentId,email,role:['admin','staff','user'].includes(requestedRole)?requestedRole:'user'});
    });
    const userRules=[...userRuleMap.values()];
    if(userRules.length){result=await c.from('member_access_rules').upsert(userRules,{onConflict:'department_id,email'});if(result.error)throw result.error;}
    superAdminCache=null;invalidate();return {items:itemPayload.length,packages:packages.length,users:userRules.length};
  }

  SLF.auth={getClient,session,googleOAuth,googleIdToken,signOut,onChange,organizations,joinDepartment,memberships,profile,departmentItems,countResults,saveCount,savedWorkspace,bootstrapWorkspace,clearOrganizationData,superAdminStatus,superAdminData,superAdminSave,superAdminDelete,importMasterData,subscribeDepartment,subscribeMasterData,dashboardData,subscribeDashboard,invalidateCache:invalidate};
})();

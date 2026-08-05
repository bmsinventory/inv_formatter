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
  function onChange(callback){const c=getClient();return c?c.auth.onAuthStateChange((event,value)=>callback(value,event)):null;}
  async function organizations(){
    return cached('organizations',async()=>{const c=getClient();const {data,error}=await c.from('organizations').select('id,name,code,departments(id,name,code)').eq('is_active',true).order('name');if(error)throw error;return data||[];},60000);
  }
  async function joinDepartment(user,organizationId,departmentId){
    const c=getClient();
    const profile={id:user.id,email:user.email||'',full_name:user.user_metadata?.full_name||user.user_metadata?.name||user.email||'',avatar_url:user.user_metadata?.avatar_url||user.user_metadata?.picture||null,last_login_at:new Date().toISOString()};
    let result=await c.from('profiles').upsert(profile,{onConflict:'id'});if(result.error)throw result.error;
    result=await c.rpc('join_stock_department',{target_department_id:departmentId});if(result.error)throw result.error;
    saveWorkspace(user.id,{organizationId,departmentId});
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
      packages.sort((a,b)=>Number(b.size)-Number(a.size));
      return {systemId:item.id,itemId:item.item_id,code:item.code,name:item.name,baseUnit:item.base_unit,unitPrice:Number(item.unit_price)||0,barcode:item.barcode||'',category:item.category||'',location:link?.location||'',packages,lots:[]};
    });},30000);
  }
  async function countResults(departmentId){
    return cached(`counts:${departmentId}`,async()=>{const c=getClient();const {data,error}=await c.from('opening_stock_counts').select('status,note,counter_name,department_item:department_items!inner(department_id,item:items(item_id)),entries:opening_stock_entries(id,lot,exp,unit_qty,package_size,entry_group,recorded_by,recorded_by_name,recorded_at)').eq('department_item.department_id',departmentId);if(error)throw error;const counts={};(data||[]).forEach(row=>{const itemId=row.department_item?.item?.item_id;if(!itemId)return;const groups=new Map();(row.entries||[]).forEach(entry=>{const key=String(entry.entry_group),lot=groups.get(key)||{entryGroup:Number(entry.entry_group),lot:entry.lot||'',exp:entry.exp||'',qty:{},recordedBy:entry.recorded_by||'',recordedByName:entry.recorded_by_name||'',recordedAt:entry.recorded_at||'',editReason:''};lot.qty[entry.package_size]=(Number(lot.qty[entry.package_size])||0)+(Number(entry.unit_qty)||0);groups.set(key,lot);});counts[itemId]={status:row.status,note:row.note||'',counterName:row.counter_name||'',lots:[...groups.values()].sort((a,b)=>a.entryGroup-b.entryGroup)};});return counts;},10000);
  }
  async function saveCount(departmentId,itemId,status,lots,note,counterName,packages){
    const c=getClient();
    if(!(packages||[]).length)throw new Error('รายการนี้ยังไม่มีข้อมูลหน่วยบรรจุ');
    if((packages||[]).some(pack=>!String(pack.stockItemUnitId||'').trim()))throw new Error('ทุกหน่วยบรรจุต้องมี stock_item_unit_id ก่อนบันทึกผลนับ');
    const entries=(lots||[]).flatMap((lot,lotIndex)=>(packages||[]).map(pack=>{const unitQty=Math.max(0,Number(lot.qty&&lot.qty[pack.size])||0);return {stock_item_unit_id:pack.stockItemUnitId,unit_qty:unitQty,package_size:Number(pack.size)||1,entry_group:Number(lot.entryGroup)||lotIndex+1,lot:lot.lot||'',exp:lot.exp||'',edit_reason:lot.editReason||''};}).filter(entry=>entry.unit_qty!==0));
    const {error}=await c.rpc('save_stock_count_locked',{target_department_id:departmentId,target_item_id:itemId,target_status:status,target_note:note||'',target_counter_name:counterName||'',entry_payload:entries});if(error)throw error;invalidate(`counts:${departmentId}`);invalidate('dashboard');
  }
  async function acquireCountLock(departmentId,itemId){const c=getClient();const {data,error}=await c.rpc('acquire_stock_item_lock',{target_department_id:departmentId,target_item_id:itemId});if(error)throw error;return Array.isArray(data)?data[0]:data;}
  async function releaseCountLock(departmentId,itemId){const c=getClient();if(!c)return;const {error}=await c.rpc('release_stock_item_lock',{target_department_id:departmentId,target_item_id:itemId});if(error)throw error;}
  async function touchStockPresence(departmentId,displayName){const c=getClient();const {error}=await c.rpc('touch_stock_presence',{target_department_id:departmentId,target_display_name:displayName||''});if(error)throw error;}
  async function leaveStockPresence(departmentId){const c=getClient();if(!c)return;await c.rpc('leave_stock_presence',{target_department_id:departmentId});}
  async function requestLotEdit(departmentId,itemId,entryGroup,reason,requesterName){const c=getClient();const {data,error}=await c.rpc('request_stock_lot_edit',{target_department_id:departmentId,target_item_id:itemId,target_entry_group:Number(entryGroup),target_reason:reason,target_requester_name:requesterName||''});if(error)throw error;return data;}
  async function respondLotEditRequest(requestId,approved){const c=getClient();const {error}=await c.rpc('respond_stock_lot_edit_request',{target_request_id:requestId,target_approved:Boolean(approved)});if(error)throw error;}
  async function pendingLotEditRequests(departmentId){const c=getClient();const {data,error}=await c.from('opening_stock_edit_requests').select('id,entry_group,requester_id,requester_name,owner_id,reason,status,created_at,count:opening_stock_counts(department_item:department_items(item:items(item_id,code,name)),entries:opening_stock_entries(entry_group,lot,exp))').eq('department_id',departmentId).eq('status','pending').order('created_at');if(error)throw error;return data||[];}
  async function lotAdjustmentHistory(departmentId,itemId,entryGroup){const c=getClient();const {data,error}=await c.from('opening_stock_adjustments').select('id,entry_group,lot,exp,stock_item_unit_id,previous_qty,new_qty,adjusted_qty,changed_by_name,change_reason,changed_at,count:opening_stock_counts!inner(department_item:department_items!inner(department_id,item:items!inner(item_id)))').eq('count.department_item.department_id',departmentId).eq('count.department_item.item.item_id',itemId).eq('entry_group',Number(entryGroup)).order('changed_at',{ascending:false});if(error)throw error;return data||[];}
  function subscribeLotEditRequests(departmentId,callback){const c=getClient();if(!c)return()=>{};const channel=c.channel(`stock-edit-requests-${departmentId}`).on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_edit_requests',filter:`department_id=eq.${departmentId}`},callback).subscribe();return()=>c.removeChannel(channel);}
  function workspaceStorageKey(userId){return userId?`bms-stock-workspace:${userId}`:'';}
  function saveWorkspace(userId,workspace){
    const key=workspaceStorageKey(userId);if(!key)return;
    try{localStorage.setItem(key,JSON.stringify(workspace));}catch(e){}
  }
  function savedWorkspace(userId){
    const key=workspaceStorageKey(userId);if(!key)return null;
    try{return JSON.parse(localStorage.getItem(key))||null;}catch(e){return null;}
  }
  async function bootstrapWorkspace(organization,department){
    const c=getClient();const {data,error}=await c.rpc('bootstrap_stock_workspace',{org_code:organization.code,org_name:organization.name,dept_code:department.code,dept_name:department.name});
    if(error)throw error;const created=Array.isArray(data)?data[0]:data;
    const current=await session();
    if(created&&current?.user?.id)saveWorkspace(current.user.id,{organizationId:created.organization_id,departmentId:created.department_id});
    return created;
  }
  async function clearOrganizationData(organizationId){
    const c=getClient();const {data,error}=await c.rpc('clear_organization_inventory',{target_organization_id:organizationId});
    if(error)throw error;superAdminCache=null;invalidate();return Number(data)||0;
  }
  async function superAdminStatus(){
    const current=await session(),userId=current?.user?.id||'';return cached(`super-status:${userId}`,async()=>{const c=getClient();const {data,error}=await c.from('platform_admins').select('user_id').eq('user_id',userId).maybeSingle();if(error){if(error.code==='42P01'||error.code==='PGRST205')return false;throw error;}return Boolean(data);},60000);
  }
  function subscribeDepartment(departmentId,callback){
    const c=getClient();if(!c)return()=>{};let timer;
    const notify=()=>{invalidate(`counts:${departmentId}`);invalidate(`items:${departmentId}`);clearTimeout(timer);timer=setTimeout(callback,350);};
    const channel=c.channel(`stock-department-${departmentId}`).on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_counts'},notify).on('postgres_changes',{event:'*',schema:'public',table:'opening_stock_entries'},notify).on('postgres_changes',{event:'*',schema:'public',table:'items'},notify).on('postgres_changes',{event:'*',schema:'public',table:'item_packages'},notify).subscribe();
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
    if(entity==='users'&&values.role==='super_admin'){
      const c=getClient(),result=await c.rpc('add_super_admin_by_email',{target_email:values.email});
      if(result.error)throw result.error;superAdminCache=null;invalidate();return {user_id:result.data};
    }
    const table=adminTables[entity];if(!table)throw new Error('Unsupported master-data entity');
    const c=getClient(),query=id?c.from(table).update(values).eq('id',id):c.from(table).insert(values);
    const {data,error}=await query.select().single();if(error)throw error;superAdminCache=null;invalidate();return data;
  }
  async function superAdminDelete(entity,id){
    const table=adminTables[entity];if(!table)throw new Error('Unsupported master-data entity');
    const c=getClient();const {error}=await c.from(table).delete().eq('id',id);if(error)throw error;
    superAdminCache=null;invalidate();
  }

  async function importMasterData(organizationId,departmentId,payload,onProgress){
    const c=getClient();
    const progress=(percent,label)=>{if(typeof onProgress==='function')onProgress({percent:Math.max(0,Math.min(100,Math.round(percent))),label});};
    progress(2,'กำลังตรวจสอบข้อมูลเดิม');
    const itemPayload=payload.items.map(item=>({organization_id:organizationId,item_id:item.itemId,code:item.code,name:item.name,base_unit:item.baseUnit,unit_price:Number(item.unitPrice)||0,barcode:item.barcode||null,category:item.category||null,is_active:true}));
    let result=await c.from('items').select('id,item_id,code,name').eq('organization_id',organizationId);if(result.error)throw result.error;
    const existingByItemId=new Map((result.data||[]).map(item=>[String(item.item_id),item]));
    const existingByCodeName=new Map((result.data||[]).map(item=>[`${String(item.code)}\u0000${String(item.name||'')}`,item]));
    const incomingCodeNameCounts=new Map();
    itemPayload.forEach(item=>{const key=`${String(item.code)}\u0000${String(item.name)}`;incomingCodeNameCounts.set(key,(incomingCodeNameCounts.get(key)||0)+1);});
    const ids=new Map();
    for(let itemIndex=0;itemIndex<itemPayload.length;itemIndex++){
      const item=itemPayload[itemIndex];
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
      progress(5+((itemIndex+1)/Math.max(itemPayload.length,1))*65,`กำลังนำเข้า Items ${itemIndex+1}/${itemPayload.length}`);
    }
    const packages=payload.items.flatMap(item=>item.packages.map(pack=>({item_id:ids.get(String(item.itemId)),stock_item_unit_id:pack.stockItemUnitId||null,name:pack.name,size:Number(pack.size)||1,barcode:pack.barcode||null}))).filter(row=>row.item_id);
    if(packages.length){result=await c.from('item_packages').upsert(packages,{onConflict:'item_id,stock_item_unit_id'});if(result.error)throw result.error;}
    progress(78,`นำเข้า Packages แล้ว ${packages.length} รายการ`);
    result=await c.from('department_items').update({is_explicit:false}).eq('department_id',departmentId);if(result.error)throw result.error;
    const departmentItems=payload.items.filter(item=>item.departmentLinked).map(item=>({department_id:departmentId,item_id:ids.get(String(item.itemId)),location:item.location||null,status:'pending',is_explicit:true})).filter(row=>row.item_id);
    if(departmentItems.length){result=await c.from('department_items').upsert(departmentItems,{onConflict:'department_id,item_id'});if(result.error)throw result.error;}
    progress(88,`ผูกหน่วยงานแล้ว ${departmentItems.length} รายการ`);
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
    progress(100,'นำเข้าข้อมูลสำเร็จ');
    superAdminCache=null;invalidate();return {items:itemPayload.length,packages:packages.length,users:userRules.length};
  }

  SLF.auth={getClient,session,googleOAuth,googleIdToken,signOut,onChange,organizations,joinDepartment,memberships,profile,departmentItems,countResults,saveCount,acquireCountLock,releaseCountLock,touchStockPresence,leaveStockPresence,requestLotEdit,respondLotEditRequest,pendingLotEditRequests,lotAdjustmentHistory,subscribeLotEditRequests,savedWorkspace,bootstrapWorkspace,clearOrganizationData,superAdminStatus,superAdminData,superAdminSave,superAdminDelete,importMasterData,subscribeDepartment,subscribeMasterData,dashboardData,subscribeDashboard,invalidateCache:invalidate};
})();

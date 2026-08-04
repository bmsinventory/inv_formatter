window.SLF = window.SLF || {};

(function(){
  const STEPS = ['อัปโหลดไฟล์','เลือก Sheet / Header','จับคู่คอลัมน์','วิเคราะห์','ผู้ใช้พิจารณา','ส่งออก'];
  const FIELDS = [
    ['item_id','รหัสรายการ',false],['item_name','ชื่อรายการ',true],['category','ประเภท/หมวดหมู่',false],
    ['group','กลุ่ม',false],['unit','หน่วย',false],['package','Package',false],['brand','ยี่ห้อ',false],
    ['model','รุ่น',false],['size','ขนาด/ความแรง',false],['material','วัสดุ',false],['part_number','Part Number',false],
    ['price','ราคา',false],['remark','หมายเหตุ',false]
  ];
  const KEYWORDS = {
    item_id:['item id','item_id','id ระบบเดิม','รหัสรายการ','รหัสสินค้า','รหัสยา','inv code'],
    item_name:['item name','item_name','ชื่อรายการ','ชื่อสินค้า','ชื่อยา'],
    category:['category','ประเภท','หมวดหมู่','ประเภทรายการสินค้า','ประภทรายการสินค้า'],group:['group','กลุ่ม','กลุ่มรายการสินค้า'],unit:['unit','หน่วย','หน่วยนับ','หน่วยที่หยิบใช้ในหน่วยงาน / หน่วยนับ'],package:['package','บรรจุ','แพ็ค','ขนาดบรรจุ','หน่วยที่หยิบใช้ในหน่วยงาน / ขนาดบรรจุ'],
    brand:['brand','ยี่ห้อ','ผู้ผลิต'],model:['model','รุ่น'],size:['size','strength','ขนาด','ความแรง'],material:['material','วัสดุ'],
    part_number:['part number','part no','part_number','เลขชิ้นส่วน'],price:['price','ราคา','ราคากลาง'],remark:['remark','หมายเหตุ']
  };
  let root;
  let state = fresh();

  function fresh(){ return {step:1,fileName:'',workbook:null,sheets:[],sheet:'',rows:[],headerIndex:0,headerDepth:1,headers:[],mapping:{},mappingConfirmed:false,records:[],groups:[],decisions:{},search:''}; }
  function esc(v){ return SLF.utils.string.escapeHtml(v); }
  function norm(v){
    return String(v==null?'':v).normalize('NFKC').toLowerCase().trim()
      .replace(/([0-9])\s*(ml|mg|g|kg|cm|mm|%|มล|มก|กรัม)\b/gi,'$1 $2')
      .replace(/\s+/g,' ').replace(/[.,;:()\[\]{}_/\\-]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function tokens(v){ return [...new Set(norm(v).split(' ').filter(x=>x.length>1))]; }
  function charNgrams(v,size=3){
    const s=norm(v).replace(/\s+/g,'');if(!s)return[];if(s.length<=size)return[s];
    const out=new Set();for(let i=0;i<=s.length-size;i++)out.add(s.slice(i,i+size));return[...out];
  }
  function dice(a,b){if(!a.length||!b.length)return 0;const bs=new Set(b);let hit=0;a.forEach(x=>{if(bs.has(x))hit++;});return (2*hit)/(a.length+b.length);}
  function extractAttributes(name,itemId){
    const raw=String(name||'').normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g,'');
    const withoutPrice=raw.replace(/\([^)]*(?:บาท|฿)[^)]*\)/g,' ').replace(/\b\d+(?:\.\d+)?\s*(?:บาท|฿)\b/g,' ');
    const formatMatch=withoutPrice.match(/(?:\ba\s*([0-9]+)\b|เอ\s*([0-9]+))/i);
    const gramMatch=withoutPrice.match(/(\d+(?:\.\d+)?)\s*(?:แกรม|gram(?:s)?|gsm|g\/m2)/i);
    const strengthMatch=withoutPrice.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|%|มก|ไมโครกรัม|กรัม|มล)/i);
    const rectangular=withoutPrice.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(นิ้ว|inch|in)?/i);
    const fraction=withoutPrice.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(นิ้ว|inch|in)/i);
    const dimensionMatches=rectangular?[`${rectangular[1]}x${rectangular[2]}`]:fraction?[`${Number(fraction[1])+Number(fraction[2])/Number(fraction[3])}นิ้ว`]:[...withoutPrice.matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|m|มม|ซม|เมตร|นิ้ว|inch)/gi)].map(m=>`${m[1]}${m[2]}`);
    const numberMatch=withoutPrice.match(/(?:เบอร์|no\.?|number)\s*([0-9]+(?:\.[0-9]+)?)/i);
    const modelMatch=withoutPrice.match(/\b([a-z]{1,8}[- ]?[0-9]{2,}[a-z]?)\b/i);
    const colorWords=['ฟ้า','น้ำเงิน','แดง','เขียว','เหลือง','ขาว','ดำ','ชมพู','ม่วง','ส้ม','เทา','ใส','ครีม','ทอง','เงิน','blue','red','green','yellow','white','black','pink','purple','orange','gray','grey'];
    const colors=colorWords.filter(c=>withoutPrice.includes(`สี${c}`)||new RegExp(`(^|\\s)${c}(?=\\s|$|[),])`,'i').test(withoutPrice));
    const container=(['ขวด','ถุง','กล่อง','กระป๋อง','แกลลอน','ม้วน','แพ็ค','ห่อ'].find(x=>withoutPrice.includes(`ชนิด${x}`)||withoutPrice.includes(`แบบ${x}`))||'');
    const polarity=withoutPrice.includes('ไม่ขยาย')?'ไม่ขยาย':withoutPrice.includes('ขยาย')?'ขยาย':'';
    const variant=(withoutPrice.match(/\b(bk|col|cyan|magenta|yellow|black|\d{2,}[a-z])\b/i)||[])[1]||'';
    const format=formatMatch?`a${formatMatch[1]||formatMatch[2]}`:'';
    const gram=gramMatch?`${gramMatch[1]} แกรม`:'';
    const strength=strengthMatch?`${strengthMatch[1]} ${strengthMatch[2]}`:'';
    let core=withoutPrice.replace(/(?:\ba\s*[0-9]+\b|เอ\s*[0-9]+)/gi,' ').replace(/\d+(?:\.\d+)?\s*(?:แกรม|gram(?:s)?|gsm|g\/m2)/gi,' ').replace(/\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:นิ้ว|inch|in)?/gi,' ').replace(/\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|%|มก|ไมโครกรัม|กรัม|มล|mm|cm|m|มม|ซม|เมตร|นิ้ว|inch)/gi,' ').replace(/(?:เบอร์|no\.?|number)\s*[0-9]+(?:\.[0-9]+)?/gi,' ');
    colors.forEach(c=>{core=core.replace(new RegExp(`สี\\s*${c}|\\b${c}\\b`,'gi'),' ');});
    core=norm(core.replace(/\b(?:ขนาด|สี|ราคา)\b/g,' '));
    const id=String(itemId||'').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,''); const codeBase=id.replace(/(\/\d+)\.\d+$/,'$1');const codeFamily=codeBase.replace(/\/\d+$/,'');
    return {format,gram,strength,dimensions:dimensionMatches.sort().join(' x '),colors:colors.sort().join(','),number:numberMatch?numberMatch[1]:'',model:modelMatch?norm(modelMatch[1]):'',container,polarity,variant:variant.toLowerCase(),core,codeBase,codeFamily};
  }
  function makeUnique(values){ const seen={}; return values.map((v,i)=>{ const h=String(v==null?'':v).trim()||`คอลัมน์ ${i+1}`; seen[h]=(seen[h]||0)+1; return seen[h]===1?h:`${h} (${seen[h]})`; }); }
  function detectHeader(rows){
    let best=0,score=-1;
    rows.slice(0,20).forEach((row,i)=>{ const filled=(row||[]).filter(v=>String(v).trim()).length; const text=(row||[]).filter(v=>typeof v==='string').length; const s=filled*2+text; if(s>score){score=s;best=i;} });
    return best;
  }
  function detectHeaderDepth(){
    const top=state.rows[state.headerIndex]||[], next=state.rows[state.headerIndex+1]||[];
    const nextFilled=next.filter(v=>String(v??'').trim()).length;
    const topBlanks=top.filter(v=>!String(v??'').trim()).length;
    state.headerDepth=nextFilled>=2&&topBlanks>=2?2:1;
  }
  function autoMap(){
    const used=new Set(); state.mapping={};
    FIELDS.forEach(([key])=>{
      const keys=(KEYWORDS[key]||[]).map(norm); let found='';
      for(const h of state.headers){ if(!used.has(h)&&keys.includes(norm(h))){found=h;break;} }
      state.mapping[key]=found; if(found) used.add(found);
    });
    state.mappingConfirmed=false;
  }
  function activeFields(){ return FIELDS.filter(([key])=>Boolean(state.mapping[key])); }
  function loadSheet(){
    const ws=state.workbook.Sheets[state.sheet];
    state.rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
    state.headerIndex=detectHeader(state.rows); detectHeaderDepth(); applyHeader();
  }
  function applyHeader(){
    const top=state.rows[state.headerIndex]||[];
    if(state.headerDepth===1){state.headers=makeUnique(top);autoMap();return;}
    const sub=state.rows[state.headerIndex+1]||[];let carried='';
    const combined=Array.from({length:Math.max(top.length,sub.length)},(_,i)=>{
      const a=String(top[i]??'').trim();if(a)carried=a;
      const b=String(sub[i]??'').trim();
      if(a&&!b)return a;if(b&&carried)return `${carried} / ${b}`;return a||b||'';
    });
    state.headers=makeUnique(combined);autoMap();
  }
  function buildRecords(){
    state.records=state.rows.slice(state.headerIndex+state.headerDepth).map((row,i)=>{
      const rec={__rowNum:state.headerIndex+state.headerDepth+i+1,__source:{}};
      state.headers.forEach((h,ci)=>rec.__source[h]=row[ci]??'');
      FIELDS.forEach(([key])=>rec[key]=state.mapping[key]?rec.__source[state.mapping[key]]:'');
      rec.__nameNorm=norm(rec.item_name); rec.__tokens=tokens(rec.item_name); rec.__attrs=extractAttributes(rec.item_name,rec.item_id);rec.__grams=charNgrams(rec.__attrs.core); return rec;
    }).filter(r=>Object.values(r.__source).some(v=>String(v).trim()));
  }
  function conflict(a,b,key,label){
    const av=norm(a[key]),bv=norm(b[key]); return av&&bv&&av!==bv?`${label}: “${a[key]}” ≠ “${b[key]}”`:'';
  }
  function compare(a,b){
    const conflicts=[['size','ขนาด/ความแรง'],['model','รุ่น'],['unit','หน่วย'],['material','วัสดุ'],['part_number','Part Number'],['package','Package']].map(x=>conflict(a,b,x[0],x[1])).filter(Boolean);
    const matches=[];
    if(a.__nameNorm&&a.__nameNorm===b.__nameNorm) matches.push('ชื่อหลัง Normalize ตรงกัน (ใช้เป็นหลักฐานประกอบเท่านั้น)');
    const compactNameMatch=Boolean(a.__nameNorm&&a.__nameNorm.replace(/\s+/g,'')===b.__nameNorm.replace(/\s+/g,''));
    if(compactNameMatch&&a.__nameNorm!==b.__nameNorm)matches.push('ชื่อหลังตัดช่องว่างและเครื่องหมายตรงกัน');
    if(norm(a.item_id)&&norm(a.item_id)===norm(b.item_id)) matches.push('รหัสรายการตรงกัน');
    else if(a.__attrs.codeBase&&a.__attrs.codeBase===b.__attrs.codeBase) matches.push(`รหัสฐานตรงกัน (${a.__attrs.codeBase})`);
    [['category','หมวดหมู่'],['brand','ยี่ห้อ'],['model','รุ่น'],['unit','หน่วย'],['part_number','Part Number']].forEach(([k,l])=>{if(norm(a[k])&&norm(a[k])===norm(b[k]))matches.push(`${l}ตรงกัน`);});
    const semanticKeys=[['format','รูปแบบ/ขนาดกระดาษ'],['gram','น้ำหนักกระดาษ'],['strength','ความแรง'],['dimensions','มิติ'],['colors','สี'],['number','เบอร์'],['model','รุ่น/โมเดล'],['container','ชนิดบรรจุภัณฑ์'],['polarity','คุณสมบัติขยาย/ไม่ขยาย'],['variant','รหัสสี/Variant']];
    let semanticMatches=0;
    semanticKeys.forEach(([k,l])=>{const av=a.__attrs[k],bv=b.__attrs[k];if(av&&bv){if(av===bv){matches.push(`${l}ตรงกัน (${av})`);semanticMatches++;}else conflicts.push(`${l}: “${av}” ≠ “${bv}”`);}});
    const coreA=tokens(a.__attrs.core),coreB=tokens(b.__attrs.core),common=coreA.filter(t=>coreB.includes(t));
    const coreCoverage=Math.min(coreA.length,coreB.length)?common.length/Math.min(coreA.length,coreB.length):0;
    if(common.length>=1&&coreCoverage>=0.6) matches.push(`ชื่อหลักสอดคล้องกัน (${common.join(', ')})`);
    const charSimilarity=dice(a.__grams||charNgrams(a.__attrs.core),b.__grams||charNgrams(b.__attrs.core));
    if(charSimilarity>=0.62)matches.push(`โครงสร้างคำภาษาไทยใกล้เคียงกัน (${Math.round(charSimilarity*100)}%)`);
    const exactId=Boolean(norm(a.item_id)&&norm(a.item_id)===norm(b.item_id));
    const sameBase=Boolean(a.__attrs.codeBase&&a.__attrs.codeBase===b.__attrs.codeBase);
    const supportingColumns=['category','brand','model','unit','part_number'].filter(k=>norm(a[k])&&norm(a[k])===norm(b[k])).length;
    // ชื่อเหมือนเพียงอย่างเดียวไม่พอ: ต้องมีรหัส, attributes หรือคอลัมน์ประกอบสนับสนุน
    const hardConflicts=conflicts.filter(x=>/ขนาด|ความแรง|มิติ|สี|เบอร์|รุ่น|Part Number|Package|วัสดุ|ชนิดบรรจุภัณฑ์|คุณสมบัติ|Variant/.test(x));
    if(hardConflicts.length)return null;
    const sameFamily=Boolean(a.__attrs.codeFamily&&a.__attrs.codeFamily===b.__attrs.codeFamily);
    const candidate=exactId||a.__nameNorm===b.__nameNorm||compactNameMatch||(sameBase&&(semanticMatches>=1||coreCoverage>=0.5||charSimilarity>=0.62))||(sameFamily&&charSimilarity>=0.7&&semanticMatches>=1)||(charSimilarity>=0.72&&semanticMatches>=1)||(charSimilarity>=0.9&&supportingColumns>=1)||(coreCoverage>=0.6&&semanticMatches>=2);
    if(!candidate) return null;
    const confidence=conflicts.length?'medium':(sameBase&&(semanticMatches>=1||charSimilarity>=0.72))||(charSimilarity>=0.8&&semanticMatches>=2)?'high':'medium';
    const explanation=`${confidence==='high'?'มีหลักฐานสอดคล้องกันหลายด้าน':'พบหลักฐานที่ควรให้ผู้ใช้ตรวจสอบ'}: ${matches.join(', ')}${conflicts.length?`; ข้อมูลขัดแย้ง: ${conflicts.join(', ')}`:''}`;
    return {matches,conflicts,confidence,explanation,status:conflicts.length?'need_review':confidence==='high'?'confirmed_candidate':'possible'};
  }
  function generateGroups(records){
    const parent=records.map((_,i)=>i); const evidence=[];
    const find=x=>parent[x]===x?x:(parent[x]=find(parent[x])); const union=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
    const index=new Map();
    records.forEach((r,i)=>{
      const keys=new Set([r.__nameNorm,r.__nameNorm.replace(/\s+/g,''),norm(r.item_id),r.__attrs.codeBase,r.__attrs.codeFamily,...r.__tokens.filter(t=>t.length>=3),...r.__grams.filter((_,n)=>n%2===0).map(g=>'g:'+g)].filter(Boolean));
      const candidates=new Set(); keys.forEach(k=>(index.get(k)||[]).forEach(j=>candidates.add(j)));
      candidates.forEach(j=>{const result=compare(r,records[j]);if(result){union(i,j);evidence.push({a:i,b:j,...result});}});
      keys.forEach(k=>{if(!index.has(k))index.set(k,[]);index.get(k).push(i);});
    });
    const grouped={}; records.forEach((r,i)=>{const p=find(i);(grouped[p]=grouped[p]||[]).push(i);});
    return Object.values(grouped).filter(ids=>ids.length>1).map((ids,gi)=>{
      const ev=evidence.filter(e=>ids.includes(e.a)&&ids.includes(e.b));
      const conflicts=[...new Set(ev.flatMap(e=>e.conflicts))]; const matches=[...new Set(ev.flatMap(e=>e.matches))];
      const confidence=conflicts.length?'medium':ev.some(e=>e.confidence==='high')?'high':'medium';
      return {id:`DG-${String(gi+1).padStart(4,'0')}`,ids,matches,conflicts,confidence,explanation:ev.map(e=>e.explanation).join(' | '),suggestion:conflicts.length?'need_review':confidence==='high'?'confirmed_candidate':'possible'};
    });
  }
  function analyse(){buildRecords();state.groups=generateGroups(state.records);}
  function fileInput(file){
    if(!file||!['xlsx','xls','csv'].includes(file.name.split('.').pop().toLowerCase())) return SLF.components.toast('รองรับเฉพาะ .xlsx, .xls และ .csv','err');
    SLF.components.showLoading('กำลังอ่านไฟล์...'); const reader=new FileReader();
    reader.onload=e=>{try{state.workbook=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true});state.fileName=file.name;state.sheets=state.workbook.SheetNames;state.sheet=state.sheets[0];loadSheet();state.step=2;SLF.components.hideLoading();render();SLF.components.toast('อ่านไฟล์สำเร็จ','ok');}catch(err){SLF.components.hideLoading();SLF.components.toast('อ่านไฟล์ไม่สำเร็จ: '+err.message,'err');}};
    reader.onerror=()=>{SLF.components.hideLoading();SLF.components.toast('อ่านไฟล์ไม่สำเร็จ','err');}; reader.readAsArrayBuffer(file);
  }
  function stepNav(){ return `<aside class="dc-steps" aria-label="ขั้นตอน">${STEPS.map((s,i)=>`<div class="dc-step ${state.step===i+1?'active':state.step>i+1?'done':''}"><b>${state.step>i+1?'✓':i+1}</b><span>${s}</span></div>`).join('')}</aside>`; }
  function actions(back=true,next=true,label='ถัดไป →'){return `<div class="dc-actions"><button class="btn" data-act="back" ${back?'':'disabled'}>← ย้อนกลับ</button>${next?`<button class="btn btn-primary" data-act="next">${label}</button>`:'<span></span>'}</div>`;}
  function renderUpload(){return `<div class="panel"><h2>ตรวจสอบข้อมูลรายการซ้ำ</h2><p class="sub">นำเข้ารายการจาก Excel หรือ CSV ระบบจะวิเคราะห์และเสนอรายการที่อาจเป็นรายการเดียวกัน โดยจะไม่รวมหรือแก้ไขข้อมูลให้อัตโนมัติ</p><div class="dc-note"><strong>Decision Support:</strong> ผลทั้งหมดเป็นข้อเสนอเพื่อช่วยตรวจสอบ ผู้ใช้งานต้องเป็นผู้ยืนยันหรือปฏิเสธทุกกลุ่ม</div><label class="dc-drop"><input id="dcFile" type="file" accept=".xlsx,.xls,.csv"><div><div class="icon">📄</div><strong>คลิกเพื่อเลือก หรือลากไฟล์มาวาง</strong><p>รองรับ .xlsx, .xls, .csv และหลาย Sheet</p></div></label></div>`;}
  function renderSheet(){
    const preview=state.rows.slice(state.headerIndex,state.headerIndex+7); return `<div class="panel"><h2>2. เลือก Sheet และหัวตาราง</h2><p class="sub">ระบบเดา Sheet, แถวเริ่มต้น และจำนวนชั้นของ Header ให้แล้ว กรุณาตรวจสอบก่อนดำเนินการ</p><div class="grid grid-2"><label>Sheet<select id="dcSheet">${state.sheets.map(s=>`<option ${s===state.sheet?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>แถวเริ่มต้น Header<input id="dcHeader" type="number" min="1" max="${state.rows.length}" value="${state.headerIndex+1}"></label><label>จำนวนแถว Header<select id="dcHeaderDepth"><option value="1" ${state.headerDepth===1?'selected':''}>1 แถว</option><option value="2" ${state.headerDepth===2?'selected':''}>2 แถว</option></select></label></div><div class="dc-note">Header ที่นำไป Mapping: ${state.headers.map(esc).join(' · ')}</div><div class="table-scroll dc-preview"><table class="data"><tbody>${preview.map((r,ri)=>`<tr>${r.map(v=>`<${ri<state.headerDepth?'th':'td'}>${esc(v)}</${ri<state.headerDepth?'th':'td'}>`).join('')}</tr>`).join('')}</tbody></table></div>${actions()}</div>`;
  }
  function renderMapping(){
    const fields=activeFields(); const sample=state.rows.slice(state.headerIndex+1,state.headerIndex+6);
    return `<div class="panel"><h2>3. จับคู่คอลัมน์</h2><p class="sub">แสดงเฉพาะฟิลด์ที่พบ Header ตรงกับชื่อที่ระบบรองรับเท่านั้น ระบบจะไม่เดาจากคำบางส่วน กรุณาตรวจสอบและยืนยันก่อนวิเคราะห์</p>${state.mapping.item_name?'':`<div class="dc-note" style="border-color:var(--danger)">ไม่พบ Header “ชื่อรายการ” แบบตรงตัว ระบบจึงไม่เดาคอลัมน์อื่นแทน กรุณากลับไปตรวจสอบแถว Header</div>`}<div class="dc-map-grid">${fields.map(([k,l,req])=>`<div class="dc-map-item"><label>${l}${req?' *':''}</label><select data-map="${k}">${state.headers.map(h=>`<option value="${esc(h)}" ${state.mapping[k]===h?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><div class="section-title">ตัวอย่างข้อมูลตาม Mapping</div><div class="table-scroll dc-preview"><table class="data"><thead><tr>${fields.map(([,l])=>`<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${sample.map(row=>`<tr>${fields.map(([k])=>{const ci=state.headers.indexOf(state.mapping[k]);return `<td>${esc(row[ci]??'')}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><label class="toggle-row" style="margin-top:16px"><input id="dcMapConfirm" type="checkbox" ${state.mappingConfirmed?'checked':''}><span>ฉันตรวจสอบแล้วว่า Mapping ถูกต้อง โดยเฉพาะคอลัมน์ “ชื่อรายการ”</span></label>${actions()}</div>`;
  }
  function renderAnalysis(){
    const conflict=state.groups.filter(g=>g.conflicts.length).length; return `<div class="panel"><h2>4. ผลการวิเคราะห์</h2><p class="sub">วิเคราะห์ ${state.records.length.toLocaleString()} รายการ พบ ${state.groups.length.toLocaleString()} กลุ่มที่ควรตรวจสอบ</p><div class="stat-grid"><div class="stat-card"><div class="n">${state.records.length}</div><div class="l">รายการทั้งหมด</div></div><div class="stat-card warn"><div class="n">${state.groups.length}</div><div class="l">กลุ่มที่เสนอ</div></div><div class="stat-card danger"><div class="n">${conflict}</div><div class="l">กลุ่มที่มี Conflict</div></div><div class="stat-card"><div class="n">${state.records.length-state.groups.reduce((n,g)=>n+g.ids.length,0)}</div><div class="l">ไม่เข้ากลุ่ม</div></div></div><div class="dc-note">วิเคราะห์ด้วยรหัสฐาน, ชื่อแบบ Normalize, character n-gram ภาษาไทย และ Attributes เช่น ขนาด สี แกรม เบอร์ รุ่น และบรรจุภัณฑ์ จากนั้นตัดคู่ที่มี Conflict สำคัญออก ผลยังเป็นข้อเสนอและไม่มีรายการใดถูกยืนยันอัตโนมัติ</div>${actions(true,true,'พิจารณาผล →')}</div>`;
  }
  function groupCard(g){
    const decision=state.decisions[g.id]||'pending'; const status=g.suggestion==='need_review'?'ต้องตรวจสอบ':g.suggestion==='confirmed_candidate'?'มีหลักฐานตรงกันสูง':'อาจซ้ำ';
    return `<section class="dc-group"><div class="dc-group-head"><strong>${g.id}</strong><span class="badge ${g.conflicts.length?'badge-danger':'badge-warn'}">${status} · ${g.confidence==='high'?'ความมั่นใจสูง':'ความมั่นใจปานกลาง'}</span><div class="dc-reasons"><div>ตรงกัน: ${esc(g.matches.join(', ')||'-')}</div>${g.conflicts.length?`<div>ขัดแย้ง: ${esc(g.conflicts.join(', '))}</div>`:''}<div>คำอธิบาย: ${esc(g.explanation)}</div></div><div class="dc-review"><button class="btn btn-sm ${decision==='confirmed'?'active':''}" data-decision="confirmed" data-group="${g.id}">ยืนยันซ้ำ</button><button class="btn btn-sm ${decision==='rejected'?'active':''}" data-decision="rejected" data-group="${g.id}">ไม่ซ้ำ</button><button class="btn btn-sm ${decision==='pending'?'active':''}" data-decision="pending" data-group="${g.id}">รอตรวจ</button></div></div><div class="dc-group-body"><table class="data"><thead><tr><th>แถว</th><th>รหัส</th><th>ชื่อรายการ</th><th>ประเภท</th><th>ราคา</th><th>หน่วย</th><th>Package</th></tr></thead><tbody>${g.ids.map(i=>{const r=state.records[i];return `<tr><td>#${r.__rowNum}</td><td>${esc(r.item_id||'-')}</td><td>${esc(r.item_name||'-')}</td><td>${esc(r.category||'-')}</td><td>${esc(formatPrice(recordPrice(r)))}</td><td>${esc(r.unit||'-')}</td><td>${esc(r.package||'-')}</td></tr>`;}).join('')}</tbody></table></div></section>`;
  }
  function recordPrice(record){
    if(record.price!=null&&String(record.price).trim()!=='')return record.price;
    const match=String(record.item_name||'').match(/(?:ราคา\s*)?([0-9]+(?:[,.][0-9]+)*)\s*บาท/i);
    return match?match[1]:'';
  }
  function formatPrice(value){
    if(value==null||String(value).trim()==='')return '-';
    const number=typeof value==='number'?value:Number(String(value).replace(/,/g,''));
    return Number.isFinite(number)?number.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}):String(value);
  }
  function numericPrice(record){
    const mapped=parsePositivePrice(record.price); if(mapped>0)return mapped;
    const sourcePrices=Object.entries(record.__source||{})
      .filter(([header])=>/ราคา|price/i.test(String(header)))
      .map(([,value])=>parsePositivePrice(value)).filter(price=>price>0);
    return sourcePrices.length?Math.min(...sourcePrices):0;
  }
  function parsePositivePrice(value){
    if(value==null||String(value).trim()==='')return 0;
    const cleaned=String(value).replace(/,/g,'').match(/-?[0-9]+(?:\.[0-9]+)?/);
    const number=typeof value==='number'?value:cleaned?Number(cleaned[0]):0;
    return Number.isFinite(number)&&number>0?number:0;
  }
  function renderReview(){const q=norm(state.search);const groups=state.groups.filter(g=>!q||g.id.toLowerCase().includes(q)||g.ids.some(i=>norm(state.records[i].item_name).includes(q)));return `<div class="panel"><h2>5. ผู้ใช้พิจารณา</h2><p class="sub">ยืนยันว่า “ซ้ำ”, “ไม่ซ้ำ” หรือคงสถานะ “รอตรวจ” การเลือกเป็นการบันทึกคำตัดสินเท่านั้น ไม่มีการรวมข้อมูลต้นฉบับ</p><div class="filters"><input id="dcSearch" type="text" placeholder="ค้นหารหัสกลุ่มหรือชื่อรายการ" value="${esc(state.search)}"></div>${groups.length?groups.map(groupCard).join(''):'<div class="dc-empty">ไม่พบกลุ่มรายการที่ตรงกับการค้นหา</div>'}${actions(true,true,'ไปหน้าส่งออก →')}</div>`;}
  function renderExport(){const counts={confirmed:0,rejected:0,pending:0};state.groups.forEach(g=>counts[state.decisions[g.id]||'pending']++);return `<div class="panel"><h2>6. ส่งออกผลการตรวจสอบ</h2><p class="sub">Sheet “All Results” จะรวมกลุ่มที่ยืนยันซ้ำเป็นหนึ่งแถว และแสดง ID ระบบเดิมคั่นด้วยเครื่องหมายจุลภาค ส่วนรายการรอตรวจจะเรียงติดกันและแสดงเป็นแถบสีเหลือง นอกจากนี้ยังแยก Summary, Confirmed, Possible / Pending, Rejected และ Original Data</p><div class="stat-grid"><div class="stat-card"><div class="n">${counts.confirmed}</div><div class="l">ยืนยันซ้ำ</div></div><div class="stat-card warn"><div class="n">${counts.pending}</div><div class="l">รอตรวจ</div></div><div class="stat-card"><div class="n">${counts.rejected}</div><div class="l">ไม่ซ้ำ</div></div></div><button class="btn btn-primary" id="dcExport">ดาวน์โหลด Excel</button> <button class="btn" id="dcReset">เริ่มตรวจไฟล์ใหม่</button><div id="dcExportStatus" class="dc-note" style="margin-top:16px">ข้อมูลต้นฉบับยังไม่ได้รับการแก้ไข</div>${actions(true,false)}</div>`;}
  async function exportExcel(){
    const duplicateIds=(g,currentIndex)=>g.ids.filter(i=>i!==currentIndex).map(i=>state.records[i].item_id).filter(v=>String(v??'').trim()).join(', ');
    const rowsFor=g=>g.ids.map(i=>{const r=state.records[i],decision=state.decisions[g.id]||'pending';return {group_id:g.id,decision,suggestion:g.suggestion,confidence:g.confidence,source_row:r.__rowNum,item_id:r.item_id,duplicate_item_ids:decision==='confirmed'?duplicateIds(g,i):'',item_name:r.item_name,category:r.category,price:r.price,unit:r.unit,package:r.package,brand:r.brand,model:r.model,size:r.size,material:r.material,part_number:r.part_number,extracted_format:r.__attrs.format,extracted_gram:r.__attrs.gram,extracted_strength:r.__attrs.strength,extracted_color:r.__attrs.colors,base_code:r.__attrs.codeBase,matched_attributes:g.matches.join('; '),conflict_attributes:g.conflicts.join('; '),reason:g.explanation};});
    const wb=new ExcelJS.Workbook(); const summary=[{file:state.fileName,total_items:state.records.length,duplicate_groups:state.groups.length,confirmed:state.groups.filter(g=>state.decisions[g.id]==='confirmed').length,pending:state.groups.filter(g=>(state.decisions[g.id]||'pending')==='pending').length,rejected:state.groups.filter(g=>state.decisions[g.id]==='rejected').length,generated_at:new Date().toLocaleString('th-TH')}];
    const addSheet=(name,data,rowStyle)=>{
      const ws=wb.addWorksheet(name); const rows=data.length?data:[{message:'ไม่มีข้อมูล'}];
      ws.columns=Object.keys(rows[0]).map(key=>({header:key,key,width:Math.min(45,Math.max(14,key.length+2))}));
      rows.forEach((item,index)=>{const row=ws.addRow(item);if(rowStyle)rowStyle(row,item,index);});
      ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF244A78'}};
      ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:{row:1,column:1},to:{row:1,column:ws.columnCount}};
      ws.columns.forEach(col=>{col.width=Math.min(50,Math.max(col.width||14,...col.values.slice(1,100).map(v=>String(v??'').length+2)));});
      return ws;
    };
    addSheet('Summary',summary);
    [['Confirmed','confirmed'],['Possible_Pending','pending'],['Rejected','rejected']].forEach(([name,d])=>addSheet(name,state.groups.filter(g=>(state.decisions[g.id]||'pending')===d).flatMap(rowsFor)));
    const membership=new Map(); state.groups.forEach(g=>g.ids.forEach(i=>membership.set(i,g)));
    const resultRow=(r,i,sourceOverride={})=>{
      const g=membership.get(i); const decision=g?(state.decisions[g.id]||'pending'):'';
      const status=!g?'NOT_DUPLICATE':decision==='confirmed'?'DUPLICATE_CONFIRMED':decision==='rejected'?'REJECTED_DUPLICATE':'POSSIBLE_DUPLICATE';
      const compared=g?g.ids.filter(x=>x!==i).map(x=>`แถว ${state.records[x].__rowNum}: ${state.records[x].item_name}`).join(' | '):'';
      return {...r.__source,...sourceOverride,review_status:status,review_group_id:g?g.id:'',review_duplicate_item_ids:decision==='confirmed'?g.ids.map(x=>state.records[x].item_id).filter(v=>String(v??'').trim()).join(', '):'',review_selected_price:decision==='confirmed'?(sourceOverride.review_selected_price??0):numericPrice(r),review_confidence:g?g.confidence:'',review_compared_items:compared,review_extracted_format:r.__attrs.format,review_extracted_gram:r.__attrs.gram,review_extracted_strength:r.__attrs.strength,review_extracted_color:r.__attrs.colors,review_base_code:r.__attrs.codeBase,review_matched_attributes:g?g.matches.join('; '):'',review_conflict_attributes:g?g.conflicts.join('; '):'',review_reason:g?g.explanation:'ไม่พบผู้สมัครซ้ำตามกฎที่กำหนด',review_user_decision:decision};
    };
    const blocks=[]; const addedGroups=new Set();
    state.records.forEach((r,i)=>{
      const g=membership.get(i);
      if(!g){blocks.push({order:i,rows:[resultRow(r,i)]});return;}
      if(addedGroups.has(g.id))return; addedGroups.add(g.id);
      const decision=state.decisions[g.id]||'pending'; const order=Math.min(...g.ids);
      if(decision==='confirmed'){
        const firstIndex=g.ids[0],first=state.records[firstIndex],sourceOverride={};
        if(state.mapping.item_id)sourceOverride[state.mapping.item_id]=g.ids.map(x=>state.records[x].item_id).filter(v=>String(v??'').trim()).join(', ');
        const sourceHeaders=Object.keys(first.__source||{});
        const detectedSequenceHeaders=sourceHeaders.filter(header=>{
          const clean=String(header).normalize('NFKC').toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
          return clean.includes('ลำดับ')||clean.includes('sequence')||/^(?:no\.?|number)(?:\s|$)/i.test(clean);
        });
        const sequenceHeaders=detectedSequenceHeaders.length?detectedSequenceHeaders:sourceHeaders.slice(0,1);
        sequenceHeaders.forEach(header=>{
          sourceOverride[header]=g.ids.map(x=>state.records[x].__source[header]).filter(v=>String(v??'').trim()).join(' , ');
        });
        const positivePrices=g.ids.map(x=>numericPrice(state.records[x])).filter(price=>price>0);
        const priceHeaders=state.headers.filter(h=>/ราคา|price/i.test(String(h)));
        const centralPriceHeaders=priceHeaders.filter(h=>/ราคากลาง|central\s*price|reference\s*price/i.test(String(h)));
        const centralPrices=centralPriceHeaders.flatMap(header=>g.ids.map(x=>parsePositivePrice(state.records[x].__source[header]))).filter(price=>price>0);
        if(state.mapping.price&&centralPriceHeaders.includes(state.mapping.price)){
          g.ids.forEach(x=>{const price=parsePositivePrice(state.records[x].price);if(price>0)centralPrices.push(price);});
        }
        const selectedCentralPrice=centralPrices.length?Math.min(...centralPrices):0;
        centralPriceHeaders.forEach(header=>{sourceOverride[header]=selectedCentralPrice;});
        const packagePriceHeaders=priceHeaders.filter(header=>!centralPriceHeaders.includes(header));
        packagePriceHeaders.forEach(header=>{
          const pricesForPackage=g.ids.map(x=>parsePositivePrice(state.records[x].__source[header])).filter(price=>price>0);
          if(pricesForPackage.length)sourceOverride[header]=Math.min(...pricesForPackage);
        });
        const selectedPrice=centralPriceHeaders.length?selectedCentralPrice:(positivePrices.length?Math.min(...positivePrices):0);
        if(state.mapping.price&&!priceHeaders.includes(state.mapping.price))sourceOverride[state.mapping.price]=selectedPrice;
        sourceOverride.review_selected_price=selectedPrice;
        blocks.push({order,rows:[resultRow(first,firstIndex,sourceOverride)]});
      }else{
        blocks.push({order,rows:g.ids.slice().sort((a,b)=>a-b).map(x=>resultRow(state.records[x],x))});
      }
    });
    const allResults=blocks.sort((a,b)=>a.order-b.order).flatMap(block=>block.rows);
    addSheet('All Results',allResults,(row,item,index)=>{if(item.review_status==='DUPLICATE_CONFIRMED'){row.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFC7CE'}};cell.font={color:{argb:'FF9C0006'},bold:true};});}else if(item.review_status==='POSSIBLE_DUPLICATE'){const first=index===0||allResults[index-1].review_group_id!==item.review_group_id,last=index===allResults.length-1||allResults[index+1].review_group_id!==item.review_group_id;row.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFEB9C'}};cell.border={top:first?{style:'medium',color:{argb:'FFFFC000'}}:undefined,bottom:last?{style:'medium',color:{argb:'FFFFC000'}}:undefined};});}});
    addSheet('Original Data',state.records.map(r=>r.__source));
    const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');const fileName=`Duplicate_Review_${stamp}.xlsx`;const buffer=await wb.xlsx.writeBuffer();const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);document.getElementById('dcExportStatus').textContent='สร้างไฟล์ผลการตรวจสอบสำเร็จ';SLF.components.toast('ส่งออกไฟล์สำเร็จ','ok');
  }
  function bind(){
    const file=root.querySelector('#dcFile');if(file){file.onchange=e=>fileInput(e.target.files[0]);const drop=root.querySelector('.dc-drop');drop.ondragover=e=>{e.preventDefault();};drop.ondrop=e=>{e.preventDefault();fileInput(e.dataTransfer.files[0]);};}
    const sheet=root.querySelector('#dcSheet');if(sheet)sheet.onchange=e=>{state.sheet=e.target.value;loadSheet();render();};
    const header=root.querySelector('#dcHeader');if(header)header.onchange=e=>{state.headerIndex=Math.max(0,Math.min(state.rows.length-1,Number(e.target.value)-1));detectHeaderDepth();applyHeader();render();};
    const headerDepth=root.querySelector('#dcHeaderDepth');if(headerDepth)headerDepth.onchange=e=>{state.headerDepth=Number(e.target.value);applyHeader();render();};
    root.querySelectorAll('[data-map]').forEach(el=>el.onchange=e=>{
      const key=e.target.dataset.map, value=e.target.value;
      const duplicate=Object.entries(state.mapping).find(([k,v])=>k!==key&&v===value);
      if(duplicate){e.target.value=state.mapping[key];SLF.components.toast(`คอลัมน์ “${value}” ถูกจับคู่แล้ว กรุณาเลือกคอลัมน์อื่น`,'err');return;}
      state.mapping[key]=value;state.mappingConfirmed=false;render();
    });
    const mapConfirm=root.querySelector('#dcMapConfirm');if(mapConfirm)mapConfirm.onchange=e=>state.mappingConfirmed=e.target.checked;
    root.querySelectorAll('[data-decision]').forEach(btn=>btn.onclick=()=>{state.decisions[btn.dataset.group]=btn.dataset.decision;render();});
    const search=root.querySelector('#dcSearch');if(search)search.oninput=e=>{state.search=e.target.value;clearTimeout(search._t);search._t=setTimeout(render,250);};
    const exp=root.querySelector('#dcExport');if(exp)exp.onclick=()=>exportExcel().catch(err=>SLF.components.toast('สร้างไฟล์ไม่สำเร็จ: '+err.message,'err'));const reset=root.querySelector('#dcReset');if(reset)reset.onclick=()=>SLF.components.confirmModal('เริ่มตรวจไฟล์ใหม่?','ผลการพิจารณาที่ยังไม่ได้ส่งออกจะถูกล้าง',()=>{state=fresh();render();},'เริ่มใหม่');
    root.querySelectorAll('[data-act="back"]').forEach(b=>b.onclick=()=>{if(state.step>1){state.step--;render();}});
    root.querySelectorAll('[data-act="next"]').forEach(b=>b.onclick=()=>{
      if(state.step===2&&(!state.headers.length)){return SLF.components.toast('ไม่พบหัวตาราง','err');}
      if(state.step===3){root.querySelectorAll('[data-map]').forEach(el=>state.mapping[el.dataset.map]=el.value);if(!state.mapping.item_name)return SLF.components.toast('ไม่พบคอลัมน์ชื่อรายการแบบตรงตัว กรุณาตรวจสอบ Header','err');if(!state.mappingConfirmed)return SLF.components.toast('กรุณาตรวจสอบและยืนยัน Mapping ก่อนวิเคราะห์','err');SLF.components.showLoading('กำลังวิเคราะห์รายการ...');setTimeout(()=>{analyse();state.step=4;SLF.components.hideLoading();render();},20);return;}
      if(state.step<6){state.step++;render();}
    });
  }
  function render(){if(!root)return;let body=state.step===1?renderUpload():state.step===2?renderSheet():state.step===3?renderMapping():state.step===4?renderAnalysis():state.step===5?renderReview():renderExport();root.innerHTML=`<div class="dc-shell">${stepNav()}<main class="dc-work">${body}</main></div>`;bind();}
  function comparePair(a,b){
    const prepare=x=>{const r={...x};r.__nameNorm=norm(r.item_name);r.__tokens=tokens(r.item_name);r.__attrs=extractAttributes(r.item_name,r.item_id);r.__grams=charNgrams(r.__attrs.core);return r;};
    return compare(prepare(a),prepare(b));
  }
  function analyseRecords(records){
    const prepared=records.map((x,i)=>{const r={__rowNum:x.__rowNum||i+1,__source:x.__source||{},...x};r.__nameNorm=norm(r.item_name);r.__tokens=tokens(r.item_name);r.__attrs=extractAttributes(r.item_name,r.item_id);r.__grams=charNgrams(r.__attrs.core);return r;});
    return {records:prepared,groups:generateGroups(prepared)};
  }
  SLF.pages=SLF.pages||{};SLF.pages.duplicateCheck={render(el){root=el;render();},comparePair,analyseRecords};
})();

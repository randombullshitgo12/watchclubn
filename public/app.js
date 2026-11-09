const $ = s => document.querySelector(s);
let state=null, me=null, viewing=null;

async function api(path,opts={}){
  const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||'Something went wrong');
  return j;
}
function esc(t){return (t||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function sundayLabel(iso){
  const d=new Date((iso||'')+'T12:00:00');
  return d.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
}
function ratioFor(u){
  const list=state.items.filter(i=>i.owner===u);
  const done=list.filter(i=>i.done).length;
  return `${done}/${list.length}`;
}
const PALETTE=['#8BC34A','#E89A2B','#8FC3D9','#D62828','#7A6AE8','#E86A4A','#2F9E8F','#C44E8A'];
function accentFor(u){ const i=state.users.indexOf(u); return PALETTE[(i<0?0:i)%PALETTE.length]; }

async function load(){
  try{
    const j=await api('/api/me'); me=j.user;
  }catch(e){
    $('#signIn').hidden=false; $('#app').hidden=true;
    const p=$('#loginError'); p.textContent='Could not reach the server. Open via http://localhost:3000';
    p.hidden=false;
    return;
  }
  if(!me){ $('#signIn').hidden=false; $('#app').hidden=true; return; }
  viewing=sessionStorage.getItem('viewing')||null;
  if(viewing && !state){ try{ state=await api('/api/state'); if(!state.users.includes(viewing)) viewing=null; }catch{} }
  $('#signIn').hidden=true; $('#app').hidden=false;
  await refresh();
}
async function refresh(){
  state=await api('/api/state');
  renderHome(); renderFriends(); renderPerson();
  showHomeOrPerson();
}
function renderHome(){
  const s=state.schedule;
  $('#currentTitle').textContent = s?.current ? s.current.title : 'No pick yet';
  $('#currentMeta').textContent = s?.current
    ? `Watch at your own pace. We talk it over on ${sundayLabel(s.talk)}.`
    : 'Add a few movies and the week’s pick appears here.';
}

function renderFriends(){
  const f=$('#friends'); f.innerHTML='';
  state.users.forEach((u,i)=>{
    const b=document.createElement('button'); b.className='friend pat-'+(i%8);
    b.style.setProperty('--accent', accentFor(u));
    b.innerHTML=`<span class="name">${esc(u)}${u===me?' (you)':''}</span><span class="count">${ratioFor(u)}</span>`;
    b.onclick=()=>{ viewing=u; renderPerson(); showHomeOrPerson(); };
    f.appendChild(b);
  });
}
function showHomeOrPerson(){
  sessionStorage.setItem('viewing', viewing||'');
  $('#friendsHome').hidden = !!viewing;
  $('#personView').hidden = !viewing;
  $('#weekBanner').hidden = !!viewing;
}

function renderPerson(){
  if(!viewing) return;
  const accent=accentFor(viewing);
  $('#personHero').style.setProperty('--accent', accent);
  $('#personPill').textContent = 'LIST · ' + ratioFor(viewing);
  $('#personPill').style.background=accent;
  $('#personTitle').textContent = viewing.charAt(0).toUpperCase()+viewing.slice(1) + (viewing===me?' (you)':'');
  $('#personSub').textContent = '';
  $('#personSub').style.display='none';
  $('#personList').style.setProperty('--accent', accent);
  const list=state.items.filter(i=>i.owner===viewing);
  const ul=$('#personList'); ul.innerHTML='';
  list.forEach(it=>{
    const mine = viewing===me;
    const li=document.createElement('li'); if(it.done) li.className='done';
    li.innerHTML=`<div class="item-top"><button class="check ${it.done?'done':''}" ${mine?'':'disabled'}>${it.done?'✓':''}</button><span class="t">${esc(it.title)}</span>${mine?'<button class="del">×</button>':''}</div>`;
    const btn=li.querySelector('.check');
    if(mine) btn.onclick=async()=>{ await api(`/api/items/${it.id}/toggle`,{method:'POST'}); await refresh(); };
    const del=li.querySelector('.del');
    if(del) del.onclick=async()=>{ if(confirm(`Remove “${it.title}”?`)){ await api(`/api/items/${it.id}`,{method:'DELETE'}); await refresh(); } };
    ul.appendChild(li);
  });
  $('#personEmpty').hidden=!!list.length;
}

// Add flow (fixes "doesn't change anything": always shows what was added and opens your list)
function openAdd(){
  $('#chrome').hidden=true;
  $('#home').hidden=true;
  $('#addComposer').hidden=false;
  $('#bulkText').value=''; $('#bulkError').hidden=true; $('#bulkResult').hidden=true;
}
function closeAdd(){
  $('#chrome').hidden=false;
  $('#home').hidden=false;
  $('#addComposer').hidden=true;
}
async function bulkPost(){
  const err=$('#bulkError'); const out=$('#bulkResult');
  err.hidden=true; out.hidden=true;
  const lines=$('#bulkText').value.split(/\r?\n/).map(l=>l.trim().replace(/,\s*$/,'')).filter(Boolean);
  if(!lines.length){ err.textContent='Write at least one movie.'; err.hidden=false; return; }
  try{
    const j=await api('/api/items/bulk',{method:'POST',body:JSON.stringify({titles:lines})});
    viewing=me;
    await refresh();
    closeAdd();
    showHomeOrPerson();
    renderPerson();
  }catch(e){ err.textContent=e.message; err.hidden=false; }
}

// events
$('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  try{ await api('/api/login',{method:'POST',body:JSON.stringify({name:$('#loginName').value.trim().toLowerCase(),password:$('#loginPass').value})}); await load(); }
  catch(err){ const p=$('#loginError'); p.textContent=err.message; p.hidden=false; }
};
$('#backBtn').onclick=()=>{ viewing=null; showHomeOrPerson(); };
$('#cancelAddBtn').onclick=closeAdd;
$('#addBtn').onclick=openAdd;
$('#bulkPostBtn').onclick=bulkPost;

load();

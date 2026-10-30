const CATS = ['স্থানীয় সংবাদ','জাতীয়','আন্তর্জাতিক','খেলাধুলা','বিনোদন','জনতার কণ্ঠস্বর','উন্নয়ন','মতামত'];
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function api(path, method, body){
  const r = await fetch(path, {method, headers:{'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined});
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || 'সমস্যা হয়েছে');
  return j;
}
async function init(){
  const me = await api('/api/me','GET');
  document.getElementById('fCat').innerHTML = CATS.map(c=>`<option>${c}</option>`).join('');
  if(!me.hasAdmin){ document.getElementById('setupBox').style.display='block'; }
  else if(!me.loggedIn){ document.getElementById('loginBox').style.display='block'; }
  else { document.getElementById('dash').style.display='block'; await loadAdmin(); }
}
document.getElementById('setupBtn').onclick = async ()=>{
  const p = document.getElementById('setupPass').value, p2 = document.getElementById('setupPass2').value;
  if(p !== p2) return document.getElementById('setupMsg').textContent = 'দুইবার একই পাসওয়ার্ড দিন।';
  try{ await api('/api/setup','POST',{password:p}); location.reload(); }
  catch(e){ document.getElementById('setupMsg').textContent = e.message; }
};
document.getElementById('loginBtn').onclick = async ()=>{
  try{ await api('/api/login','POST',{password: document.getElementById('loginPass').value}); location.reload(); }
  catch(e){ document.getElementById('loginMsg').textContent = e.message; }
};
document.getElementById('logoutBtn').onclick = async ()=>{ await api('/api/logout','POST'); location.reload(); };
document.getElementById('exportBtn').onclick = async ()=>{
  const posts = await api('/api/admin/posts','GET');
  const blob = new Blob([JSON.stringify(posts,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'dharmapur-times-posts-backup.json'; a.click();
};
async function loadAdmin(){
  const posts = await api('/api/admin/posts','GET');
  const s = await api('/api/admin/settings','GET');
  document.getElementById('sName').value = s.siteName||''; document.getElementById('sTagline').value = s.tagline||'';
  document.getElementById('sBreaking').value = s.breaking||''; document.getElementById('sFb').value = s.facebook||'';
  document.getElementById('sYt').value = s.youtube||''; document.getElementById('sContact').value = s.contact||'';
  document.getElementById('postTable').innerHTML = '<table><tr><th>শিরোনাম</th><th>ক্যাটাগরি</th><th>অবস্থা</th><th></th></tr>' +
    posts.map(p=>`<tr><td>${esc(p.title)}</td><td>${esc(p.category)}</td><td>${p.published?'পাবলিশড':'ড্রাফট'}</td>
    <td><button onclick="delPost('${p.id}')">ডিলিট</button></td></tr>`).join('') + '</table>';
}
window.delPost = async (id)=>{
  if(!confirm('এই পোস্টটি ডিলিট করবেন?')) return;
  await api('/api/admin/posts/'+id,'DELETE'); await loadAdmin();
};
document.getElementById('postForm').onsubmit = async (e)=>{
  e.preventDefault();
  let imageData = '';
  const file = document.getElementById('fImage').files[0];
  if(file){
    imageData = await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file); });
  }
  try{
    await api('/api/admin/posts','POST',{
      title: document.getElementById('fTitle').value,
      category: document.getElementById('fCat').value,
      summary: document.getElementById('fSummary').value,
      body: document.getElementById('fBody').value,
      imageUrl: document.getElementById('fImageUrl').value,
      imageData, breaking: document.getElementById('fBreaking').checked,
      published: document.getElementById('fPublished').checked,
    });
    document.getElementById('postMsg').textContent = 'পোস্ট সেভ হয়েছে।';
    e.target.reset(); await loadAdmin();
  }catch(err){ document.getElementById('postMsg').textContent = err.message; }
};
document.getElementById('settingsForm').onsubmit = async (e)=>{
  e.preventDefault();
  await api('/api/admin/settings','PUT',{
    siteName: document.getElementById('sName').value, tagline: document.getElementById('sTagline').value,
    breaking: document.getElementById('sBreaking').value, facebook: document.getElementById('sFb').value,
    youtube: document.getElementById('sYt').value, contact: document.getElementById('sContact').value,
  });
  alert('সেটিংস সেভ হয়েছে।');
};
document.getElementById('passForm').onsubmit = async (e)=>{
  e.preventDefault();
  try{
    await api('/api/admin/change-password','POST',{current: document.getElementById('oldPass').value, newPassword: document.getElementById('newPass').value});
    document.getElementById('passMsg').textContent = 'পাসওয়ার্ড বদলে গেছে।';
  }catch(err){ document.getElementById('passMsg').textContent = err.message; }
};
init();

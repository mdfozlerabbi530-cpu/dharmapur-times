const CATS = ['স্থানীয় সংবাদ','জাতীয়','আন্তর্জাতিক','খেলাধুলা','বিনোদন','শিক্ষা','জনতার কণ্ঠস্বর','উন্নয়ন','মতামত'];
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(d){try{return new Date(d).toLocaleDateString('bn-BD',{year:'numeric',month:'long',day:'numeric'})}catch(e){return d}}
let allPosts=[];
async function load(){
  const [s, posts] = await Promise.all([
    fetch('/api/settings').then(r=>r.json()),
    fetch('/api/posts').then(r=>r.json()),
  ]);
  document.getElementById('siteName').textContent = s.siteName || 'ধর্মপুর টাইমস';
  document.getElementById('siteTagline').textContent = s.tagline || '';
  const breakingPosts = posts.filter(p=>p.breaking);
  document.getElementById('breaking').textContent = breakingPosts.length ? breakingPosts.map(p=>p.title).join(' • ') : (s.breaking || '');
  document.getElementById('contact').textContent = s.contact || '';
  document.getElementById('today').textContent = fmt(new Date());
  allPosts = posts;
  const nav = document.getElementById('cats');
  nav.innerHTML = '<button data-cat="" class="active">হোম</button>' + CATS.map(c=>`<button data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  nav.querySelectorAll('button').forEach(b=>b.onclick=()=>{nav.querySelectorAll('button').forEach(x=>x.classList.remove('active'));b.classList.add('active');render(b.dataset.cat,'');});
  const sel = document.getElementById('catFilter');
  sel.innerHTML = '<option value="">সব ক্যাটাগরি</option>' + CATS.map(c=>`<option>${esc(c)}</option>`).join('');
  render('','');
  const postId = new URLSearchParams(location.search).get('post');
  if(postId && posts.some(p=>p.id===postId)) showDetail(postId);
}
function isImageUrl(u){ return !!u && (/^\/uploads\//.test(u) || /\.(png|jpe?g|webp)(\?.*)?$/i.test(u)); }
async function copyPostLink(e, id, btn){
  if(e) e.stopPropagation();
  const link = location.origin + '/?post=' + id;
  try{ await navigator.clipboard.writeText(link); }
  catch(err){
    const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  if(btn){ const old = btn.textContent; btn.textContent = 'কপি হয়েছে!'; setTimeout(()=>{ btn.textContent = old; }, 2000); }
}
function card(p){
  const img = isImageUrl(p.imageUrl) ? esc(p.imageUrl) : '/assets/logo.jpg';
  return `<article class="card" onclick="showDetail('${p.id}')">
    <img src="${img}" alt="">
    <div class="pad"><span class="badge">${esc(p.category)}</span>
    <h3>${esc(p.title)}</h3><p>${esc(p.summary||'')}</p>
    <div style="margin-top:10px"><time>${fmt(p.createdAt)}</time> <button class="btn ghost" style="margin-left:8px" onclick="copyPostLink(event,'${p.id}',this)">লিংক কপি করুন</button></div></div></article>`;
}
function headline(p){
  return `<div class="side-item" onclick="showDetail('${p.id}')">
    <h3>${esc(p.title)}</h3>
    <div class="meta"><b>${esc(p.category)}</b> · ${fmt(p.createdAt)}</div></div>`;
}
function render(cat,q){
  let posts = allPosts;
  if(cat) posts = posts.filter(p=>p.category===cat);
  if(q) posts = posts.filter(p=>(p.title+' '+(p.summary||'')).toLowerCase().includes(q.toLowerCase()));
  document.getElementById('empty').style.display = posts.length ? 'none' : 'block';
  const feat = document.getElementById('featured');
  feat.innerHTML = posts.length ? card(posts[0]) : '';
  document.getElementById('sideList').innerHTML = posts.slice(1,6).map(headline).join('');
  document.getElementById('grid').innerHTML = posts.slice(6).map(card).join('');
}
async function showDetail(id){
  const p = await fetch('/api/posts/'+id).then(r=>r.json());
  if(!p || !p.id) return;
  document.getElementById('listView').style.display='none';
  const d = document.getElementById('detailView'); d.style.display='block';
  const link = location.origin + '/?post=' + p.id;
  document.getElementById('detail').innerHTML = `
    <span class="badge">${esc(p.category)}</span>
    <h2>${esc(p.title)}</h2><time>${fmt(p.createdAt)}</time>
    ${isImageUrl(p.imageUrl)?`<img src="${esc(p.imageUrl)}" alt="" style="margin-top:14px">`:''}
    <p>${esc(p.body||'')}</p>
    <p><button class="btn" id="copyLinkBtn">লিংক কপি করুন</button> <span id="copyMsg"></span></p>
    <p style="color:#555;word-break:break-all">${esc(link)}</p>`;
  try{ history.replaceState(null,'','/?post='+p.id); }catch(e){}
  document.getElementById('copyLinkBtn').onclick = async ()=>{
    try{ await navigator.clipboard.writeText(link); }
    catch(e){
      const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    document.getElementById('copyMsg').textContent = 'লিংক কপি হয়েছে!';
  };
  window.scrollTo(0,0);
}
document.getElementById('backBtn').onclick=()=>{document.getElementById('detailView').style.display='none';document.getElementById('listView').style.display='block';try{ history.replaceState(null,'','/'); }catch(e){}};
document.getElementById('searchBtn').onclick=()=>render(document.getElementById('catFilter').value, document.getElementById('q').value);
document.getElementById('catFilter').onchange=(e)=>render(e.target.value, document.getElementById('q').value);
document.getElementById('q').addEventListener('keydown',e=>{if(e.key==='Enter')render(document.getElementById('catFilter').value,e.target.value)});
load();

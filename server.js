// Dharmapur Times — free deployable news website.
// No external dependencies: only Node.js built-ins.
// Run: node server.js   (PORT env var, default 3000)
// First visit /admin and set an admin password. That password is
// stored only as a scrypt hash, never in plain text.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DEFAULT_DATA = {
  settings: {
    siteName: 'ধর্মপুর টাইমস',
    tagline: 'সত্যের পক্ষে, জনতার পাশে',
    breaking: 'ধর্মপুর টাইমসে স্বাগতম — স্থানীয় সংবাদ, জনতার কণ্ঠস্বর আর উন্নয়নের খবর এখানে পাবেন।',
    facebook: '',
    youtube: '',
    contact: 'যোগাযোগের তথ্য অ্যাডমিন প্যানেল থেকে বসান।',
    adCode: '',
  },
  posts: [
    {
      id: 'welcome',
      title: 'ধর্মপুর টাইমসে স্বাগতম',
      category: 'স্থানীয় সংবাদ',
      summary: 'এটি একটি নমুনা পোস্ট। অ্যাডমিন প্যানেল থেকে এটি ডিলিট করে আপনার প্রথম আসল খবর পোস্ট করতে পারবেন।',
      body: 'ধর্মপুর টাইমসের ওয়েবসাইট তৈরি। এখানে স্থানীয় সংবাদ, জনতার কণ্ঠস্বর, উন্নয়নসহ নানা ক্যাটাগরির খবর প্রকাশ করা যাবে।\n\nঅ্যাডমিন প্যানেলে গিয়ে নতুন পোস্ট লিখুন, ছবি দিন, ক্যাটাগরি বেছে নিন, আর পাবলিশ করুন — সঙ্গে সঙ্গে পাবলিক সাইটে খবরটি দেখা যাবে।',
      imageUrl: '',
      breaking: true,
      published: true,
      createdAt: new Date().toISOString(),
    },
  ],
  admin: null, // { salt, hash } — set on first /admin visit
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Could not read data file, using defaults:', e.message); }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}
let data = loadData();

function saveData() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
if (!fs.existsSync(DATA_FILE)) saveData();

const sessions = new Map(); // token -> expiresAt
const loginAttempts = new Map(); // ip -> { count, resetAt }

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function getSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim())
    .find(s => s.startsWith('dt_session='));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.split('=')[1] || '');
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return null; }
  return token;
}
function requireAuth(req, res) {
  if (!getSession(req)) { sendJson(res, 401, { error: 'লগইন করা নেই।' }); return false; }
  return true;
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too_large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req, res) {
  try {
    const text = await readBody(req);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    sendJson(res, 400, { error: 'ভুল ডাটা পাঠানো হয়েছে।' });
    return null;
  }
}
function publicPost(p) {
  const { id, title, category, summary, body, imageUrl, breaking, createdAt } = p;
  return { id, title, category, summary, body, imageUrl, breaking, createdAt };
}
function newId() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('পাওয়া যায়নি'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // ---- Public API ----
    if (pathname === '/api/settings' && req.method === 'GET') {
      return sendJson(res, 200, data.settings);
    }
    if (pathname === '/api/me' && req.method === 'GET') {
      return sendJson(res, 200, { loggedIn: !!getSession(req), hasAdmin: !!data.admin });
    }
    if (pathname === '/api/posts' && req.method === 'GET') {
      let posts = data.posts.filter(p => p.published);
      const cat = url.searchParams.get('category');
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (cat) posts = posts.filter(p => p.category === cat);
      if (q) posts = posts.filter(p => (p.title + ' ' + p.summary + ' ' + p.body).toLowerCase().includes(q));
      posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, posts.map(publicPost));
    }
    if (pathname.startsWith('/api/posts/') && req.method === 'GET') {
      const post = data.posts.find(p => p.id === pathname.split('/')[3] && p.published);
      if (!post) return sendJson(res, 404, { error: 'খবর পাওয়া যায়নি।' });
      return sendJson(res, 200, publicPost(post));
    }

    // ---- Admin setup / login (no admin link is shown on the public site) ----
    if (pathname === '/api/setup' && req.method === 'POST') {
      if (data.admin) return sendJson(res, 403, { error: 'অ্যাডমিন ইতিমধ্যে সেট করা আছে।' });
      const body = await readJson(req, res); if (!body) return;
      if (!body.password || body.password.length < 8) {
        return sendJson(res, 400, { error: 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      data.admin = { salt, hash: hashPassword(body.password, salt) };
      saveData();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const att = loginAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
      if (att.resetAt < now) { att.count = 0; att.resetAt = now + 10 * 60 * 1000; }
      if (att.count >= 5) return sendJson(res, 429, { error: 'অনেকবার ভুল চেষ্টা হয়েছে। ১০ মিনিট পর আবার চেষ্টা করুন।' });
      const body = await readJson(req, res); if (!body) return;
      if (!data.admin || !body.password) { att.count++; loginAttempts.set(ip, att); return sendJson(res, 401, { error: 'ভুল পাসওয়ার্ড।' }); }
      const hash = hashPassword(body.password, data.admin.salt);
      const ok = crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(data.admin.hash));
      if (!ok) { att.count++; loginAttempts.set(ip, att); return sendJson(res, 401, { error: 'ভুল পাসওয়ার্ড।' }); }
      loginAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, now + 7 * 24 * 60 * 60 * 1000);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `dt_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = getSession(req); if (token) sessions.delete(token);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'dt_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0',
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    // ---- Admin API (login required) ----
    if (pathname.startsWith('/api/admin/')) {
      if (!requireAuth(req, res)) return;
      if (pathname === '/api/admin/posts' && req.method === 'GET') {
        const posts = [...data.posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return sendJson(res, 200, posts);
      }
      if (pathname === '/api/admin/settings' && req.method === 'GET') return sendJson(res, 200, data.settings);
      if (pathname === '/api/admin/settings' && req.method === 'PUT') {
        const body = await readJson(req, res); if (!body) return;
        data.settings = { ...data.settings, ...body };
        saveData(); return sendJson(res, 200, data.settings);
      }
      if (pathname === '/api/admin/change-password' && req.method === 'POST') {
        const body = await readJson(req, res); if (!body) return;
        const cur = hashPassword(body.current || '', data.admin.salt);
        if (!crypto.timingSafeEqual(Buffer.from(cur), Buffer.from(data.admin.hash))) {
          return sendJson(res, 401, { error: 'বর্তমান পাসওয়ার্ড ভুল।' });
        }
        if (!body.newPassword || body.newPassword.length < 8) {
          return sendJson(res, 400, { error: 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।' });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        data.admin = { salt, hash: hashPassword(body.newPassword, salt) };
        saveData(); return sendJson(res, 200, { ok: true });
      }
      if (pathname === '/api/admin/posts' && req.method === 'POST') {
        const body = await readJson(req, res); if (!body) return;
        if (!body.title || !body.body) return sendJson(res, 400, { error: 'শিরোনাম আর বিস্তারিত লেখা লাগবে।' });
        const post = {
          id: newId(), title: String(body.title).slice(0, 200),
          category: String(body.category || 'স্থানীয় সংবাদ').slice(0, 60),
          summary: String(body.summary || '').slice(0, 500),
          body: String(body.body).slice(0, 20000),
          imageUrl: '', breaking: !!body.breaking,
          published: body.published !== false, createdAt: new Date().toISOString(),
        };
        if (body.imageUrl) post.imageUrl = String(body.imageUrl).slice(0, 1000);
        if (body.imageData && typeof body.imageData === 'string') {
          const m = body.imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
          if (m) {
            const buf = Buffer.from(m[2], 'base64');
            if (buf.length <= 3 * 1024 * 1024) {
              const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
              const name = post.id + '.' + ext;
              fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
              post.imageUrl = '/uploads/' + name;
            }
          }
        }
        data.posts.unshift(post); saveData();
        return sendJson(res, 200, post);
      }
      if (pathname.startsWith('/api/admin/posts/')) {
        const id = pathname.split('/')[4];
        const post = data.posts.find(p => p.id === id);
        if (!post) return sendJson(res, 404, { error: 'খবর পাওয়া যায়নি।' });
        if (req.method === 'PUT') {
          const body = await readJson(req, res); if (!body) return;
          if (body.title) post.title = String(body.title).slice(0, 200);
          if (body.category) post.category = String(body.category).slice(0, 60);
          if (body.summary !== undefined) post.summary = String(body.summary).slice(0, 500);
          if (body.body) post.body = String(body.body).slice(0, 20000);
          if (body.imageUrl !== undefined) post.imageUrl = String(body.imageUrl).slice(0, 1000);
          if (body.breaking !== undefined) post.breaking = !!body.breaking;
          if (body.published !== undefined) post.published = !!body.published;
          saveData(); return sendJson(res, 200, post);
        }
        if (req.method === 'DELETE') {
          data.posts = data.posts.filter(p => p.id !== id);
          saveData(); return sendJson(res, 200, { ok: true });
        }
      }
      return sendJson(res, 404, { error: 'পাওয়া যায়নি।' });
    }

    // ---- Static files ----
    let filePath;
    if (pathname === '/' || pathname === '/index.html') filePath = path.join(PUBLIC_DIR, 'index.html');
    else if (pathname === '/admin' || pathname === '/admin.html') filePath = path.join(PUBLIC_DIR, 'admin.html');
    else filePath = path.join(PUBLIC_DIR, decodeURIComponent(pathname));
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    return serveFile(res, resolved);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'সার্ভারে সমস্যা হয়েছে।' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dharmapur Times running at http://localhost:${PORT}`);
  console.log('Admin: http://localhost:' + PORT + '/admin  (set password on first visit)');
});

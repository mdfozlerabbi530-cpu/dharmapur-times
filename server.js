// Dharmapur Times — free deployable news website.
// No external dependencies: only Node.js built-ins (global fetch is used
// for Supabase, Node >= 18).
// Run: node server.js   (PORT env var, default 3000)
// First visit /admin and set an admin password. That password is
// stored only as a scrypt hash, never in plain text.
//
// STORAGE — two modes, same API behaviour:
//   * Supabase mode (durable, for Render): set BOTH env vars
//       SUPABASE_URL and SUPABASE_SERVICE_KEY
//     Posts / settings / admin account are then stored in Supabase
//     tables (see supabase-schema.sql) via the PostgREST REST API.
//     A redeploy or restart no longer wipes posts.
//     NEVER commit a real service key to the repo. Set it only as a
//     Render environment variable. The service key bypasses row-level
//     security, so it must never be sent to browsers or put in frontend
//     code — it is used server-side only, in this file.
//   * Local mode (fallback): if either env var is missing, posts /
//     settings / admin are stored in data/data.json exactly as before,
//     so local testing works with no Supabase account at all.
//
// NOTE ON IMAGES: uploaded images still go to public/uploads on the
// server's local disk. On Render free that disk is ephemeral, so an
// uploaded image will still be lost on a redeploy/restart even in
// Supabase mode (only its /uploads/... URL string survives in the
// database, and the file behind it will be gone). For durable images
// use an image URL (a direct .jpg/.png/.webp link) instead of an upload.

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

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

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
    adcode: '',
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

// ---------------------------------------------------------------- local mode
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // Older local files predate the adcode field; keep it present so
      // the settings JSON shape matches the Supabase mode.
      parsed.settings = { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) };
      return parsed;
    }
  } catch (e) { console.error('Could not read data file, using defaults:', e.message); }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}
let data = loadData();

function saveData() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
if (!USE_SUPABASE && !fs.existsSync(DATA_FILE)) saveData();

// ------------------------------------------------------------- Supabase mode
// Thin PostgREST client. No keys are logged or returned to clients.
async function sbRequest(table, query, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query || ''}`, {
    method: method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${table} ${method || 'GET'} failed: ${res.status}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}
async function sbRows(table, query) {
  const rows = await sbRequest(table, query, 'GET');
  return Array.isArray(rows) ? rows : [];
}
async function sbOne(table, query) {
  const rows = await sbRows(table, query);
  return rows[0] || null;
}
// Upserts use this dedicated call because merge-duplicates needs its
// own Prefer header (primary-key upsert, never overwriting other rows).
async function sbUpsertRow(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase ${table} upsert failed: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function rowToPost(r) {
  return {
    id: r.id, title: r.title, category: r.category, summary: r.summary,
    body: r.body, imageUrl: r.imageurl || '', breaking: !!r.breaking,
    published: !!r.published, createdAt: r.createdat,
  };
}
function postToRow(p) {
  return {
    id: p.id, title: p.title, category: p.category, summary: p.summary,
    body: p.body, imageurl: p.imageUrl || '', breaking: !!p.breaking,
    published: !!p.published, createdat: p.createdAt,
  };
}
function rowToSettings(r) {
  return {
    siteName: r.sitename, tagline: r.tagline, breaking: r.breaking,
    facebook: r.facebook || '', youtube: r.youtube || '',
    contact: r.contact || '', adcode: r.adcode || '',
  };
}
function settingsToRow(s) {
  return {
    id: 1, sitename: s.siteName, tagline: s.tagline, breaking: s.breaking,
    facebook: s.facebook || '', youtube: s.youtube || '',
    contact: s.contact || '', adcode: s.adcode || '',
  };
}

let seeded = false;
async function ensureSeeded() {
  if (!USE_SUPABASE || seeded) return;
  // Seed only when the tables are empty, never overwriting live data.
  const settingsRow = await sbOne('site_settings', '?id=eq.1');
  if (!settingsRow) await sbUpsertRow('site_settings', settingsToRow(DEFAULT_DATA.settings));
  const posts = await sbRows('posts', '?select=id&limit=1');
  if (posts.length === 0) {
    const welcome = JSON.parse(JSON.stringify(DEFAULT_DATA.posts[0]));
    welcome.createdAt = new Date().toISOString();
    await sbRequest('posts', '', 'POST', postToRow(welcome));
  }
  seeded = true;
}

// ------------------------------------------------------- unified store (async)
const store = {
  async getSettings() {
    if (!USE_SUPABASE) return data.settings;
    await ensureSeeded();
    const row = await sbOne('site_settings', '?id=eq.1');
    return row ? rowToSettings(row) : JSON.parse(JSON.stringify(DEFAULT_DATA.settings));
  },
  async saveSettings(settings) {
    if (!USE_SUPABASE) { data.settings = settings; saveData(); return settings; }
    await ensureSeeded();
    await sbUpsertRow('site_settings', settingsToRow(settings));
    return settings;
  },
  async getAdmin() {
    if (!USE_SUPABASE) return data.admin;
    await ensureSeeded();
    const row = await sbOne('admin_account', '?id=eq.1');
    return row ? { salt: row.salt, hash: row.hash } : null;
  },
  async saveAdmin(admin) {
    if (!USE_SUPABASE) { data.admin = admin; saveData(); return; }
    await ensureSeeded();
    await sbUpsertRow('admin_account', { id: 1, salt: admin.salt, hash: admin.hash });
  },
  async getPosts() {
    if (!USE_SUPABASE) return data.posts;
    await ensureSeeded();
    const rows = await sbRows('posts', '?select=*');
    return rows.map(rowToPost);
  },
  async getPost(id) {
    if (!USE_SUPABASE) return data.posts.find(p => p.id === id) || null;
    await ensureSeeded();
    const row = await sbOne('posts', `?id=eq.${encodeURIComponent(id)}`);
    return row ? rowToPost(row) : null;
  },
  async createPost(post) {
    if (!USE_SUPABASE) { data.posts.unshift(post); saveData(); return post; }
    await ensureSeeded();
    await sbRequest('posts', '', 'POST', postToRow(post));
    return post;
  },
  async updatePost(id, patch) {
    if (!USE_SUPABASE) {
      const post = data.posts.find(p => p.id === id);
      if (!post) return null;
      Object.assign(post, patch); saveData(); return post;
    }
    await ensureSeeded();
    const existing = await this.getPost(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await sbRequest('posts', `?id=eq.${encodeURIComponent(id)}`, 'PATCH', postToRow(merged));
    return merged;
  },
  async deletePost(id) {
    if (!USE_SUPABASE) {
      const before = data.posts.length;
      data.posts = data.posts.filter(p => p.id !== id); saveData();
      return data.posts.length !== before;
    }
    await ensureSeeded();
    await sbRequest('posts', `?id=eq.${encodeURIComponent(id)}`, 'DELETE');
    return true;
  },
};

// ---------------------------------------------------------------- shared bits
const sessions = new Map(); // token -> expiresAt
const loginAttempts = new Map(); // ip -> { count, resetAt }

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function hashesEqual(a, b) {
  try {
    const ba = Buffer.from(a || '');
    const bb = Buffer.from(b || '');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch (e) { return false; }
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
      return sendJson(res, 200, await store.getSettings());
    }
    if (pathname === '/api/me' && req.method === 'GET') {
      return sendJson(res, 200, { loggedIn: !!getSession(req), hasAdmin: !!(await store.getAdmin()) });
    }
    if (pathname === '/api/posts' && req.method === 'GET') {
      let posts = (await store.getPosts()).filter(p => p.published);
      const cat = url.searchParams.get('category');
      const q = (url.searchParams.get('q') || '').toLowerCase();
      if (cat) posts = posts.filter(p => p.category === cat);
      if (q) posts = posts.filter(p => (p.title + ' ' + p.summary + ' ' + p.body).toLowerCase().includes(q));
      posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, posts.map(publicPost));
    }
    if (pathname.startsWith('/api/posts/') && req.method === 'GET') {
      const post = await store.getPost(pathname.split('/')[3]);
      if (!post || !post.published) return sendJson(res, 404, { error: 'খবর পাওয়া যায়নি।' });
      return sendJson(res, 200, publicPost(post));
    }

    // ---- Admin setup / login (no admin link is shown on the public site) ----
    if (pathname === '/api/setup' && req.method === 'POST') {
      if (await store.getAdmin()) return sendJson(res, 403, { error: 'অ্যাডমিন ইতিমধ্যে সেট করা আছে।' });
      const body = await readJson(req, res); if (!body) return;
      if (!body.password || body.password.length < 8) {
        return sendJson(res, 400, { error: 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      await store.saveAdmin({ salt, hash: hashPassword(body.password, salt) });
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const att = loginAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
      if (att.resetAt < now) { att.count = 0; att.resetAt = now + 10 * 60 * 1000; }
      if (att.count >= 5) return sendJson(res, 429, { error: 'অনেকবার ভুল চেষ্টা হয়েছে। ১০ মিনিট পর আবার চেষ্টা করুন।' });
      const body = await readJson(req, res); if (!body) return;
      const admin = await store.getAdmin();
      if (!admin || !body.password) { att.count++; loginAttempts.set(ip, att); return sendJson(res, 401, { error: 'ভুল পাসওয়ার্ড।' }); }
      const hash = hashPassword(body.password, admin.salt);
      const ok = hashesEqual(hash, admin.hash);
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
        const posts = [...(await store.getPosts())].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return sendJson(res, 200, posts);
      }
      if (pathname === '/api/admin/settings' && req.method === 'GET') return sendJson(res, 200, await store.getSettings());
      if (pathname === '/api/admin/settings' && req.method === 'PUT') {
        const body = await readJson(req, res); if (!body) return;
        const settings = { ...(await store.getSettings()), ...body };
        await store.saveSettings(settings); return sendJson(res, 200, settings);
      }
      if (pathname === '/api/admin/change-password' && req.method === 'POST') {
        const body = await readJson(req, res); if (!body) return;
        const admin = await store.getAdmin();
        if (!admin) return sendJson(res, 401, { error: 'বর্তমান পাসওয়ার্ড ভুল।' });
        const cur = hashPassword(body.current || '', admin.salt);
        if (!hashesEqual(cur, admin.hash)) {
          return sendJson(res, 401, { error: 'বর্তমান পাসওয়ার্ড ভুল।' });
        }
        if (!body.newPassword || body.newPassword.length < 8) {
          return sendJson(res, 400, { error: 'নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।' });
        }
        const salt = crypto.randomBytes(16).toString('hex');
        await store.saveAdmin({ salt, hash: hashPassword(body.newPassword, salt) });
        return sendJson(res, 200, { ok: true });
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
        await store.createPost(post);
        return sendJson(res, 200, post);
      }
      if (pathname.startsWith('/api/admin/posts/')) {
        const id = pathname.split('/')[4];
        const post = await store.getPost(id);
        if (!post) return sendJson(res, 404, { error: 'খবর পাওয়া যায়নি।' });
        if (req.method === 'PUT') {
          const body = await readJson(req, res); if (!body) return;
          const patch = {};
          if (body.title) patch.title = String(body.title).slice(0, 200);
          if (body.category) patch.category = String(body.category).slice(0, 60);
          if (body.summary !== undefined) patch.summary = String(body.summary).slice(0, 500);
          if (body.body) patch.body = String(body.body).slice(0, 20000);
          if (body.imageUrl !== undefined) patch.imageUrl = String(body.imageUrl).slice(0, 1000);
          if (body.breaking !== undefined) patch.breaking = !!body.breaking;
          if (body.published !== undefined) patch.published = !!body.published;
          const updated = await store.updatePost(id, patch);
          return sendJson(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          await store.deletePost(id);
          return sendJson(res, 200, { ok: true });
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
  console.log(`Dharmapur Times running at http://localhost:${PORT} (${USE_SUPABASE ? 'Supabase mode' : 'local data.json mode'})`);
  console.log('Admin: http://localhost:' + PORT + '/admin  (set password on first visit)');
});

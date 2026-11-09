const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config ---
// Shared password for ALL friends. Set via env SHARED_PASSWORD on Vercel.
// Default only for local demo - CHANGE IT before sharing the link.
const SHARED_PASSWORD = process.env.SHARED_PASSWORD || 'crew123';
const OWNER_NAME = (process.env.OWNER_NAME || 'owner').toLowerCase();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

// ---------- DB (JSON file for local dev) ----------
// For Vercel persistence later swap this with Vercel KV / Upstash / Supabase.
// This keeps local running zero-setup.
function loadDb() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    const seed = {
      users: ['owner', 'maya', 'leo', 'zoe'],
      items: [
        { id: '1', owner: 'maya', title: 'Dune: Part Two', type: 'watch', done: false, createdAt: Date.now() - 4000 },
        { id: '2', owner: 'leo', title: 'Dune: Part Two', type: 'watch', done: false, createdAt: Date.now() - 3000 },
        { id: '3', owner: 'zoe', title: 'Dune: Part Two', type: 'watch', done: false, createdAt: Date.now() - 2000 },
        { id: '4', owner: 'owner', title: 'Past Lives', type: 'watch', done: false, createdAt: Date.now() - 1000 },
        { id: '5', owner: 'maya', title: 'Past Lives', type: 'watch', done: false, createdAt: Date.now() - 900 },
        { id: '6', owner: 'leo', title: 'The Midnight Library', type: 'read', done: false, createdAt: Date.now() - 800 },
        { id: '7', owner: 'zoe', title: 'The Midnight Library', type: 'read', done: false, createdAt: Date.now() - 700 },
        { id: '8', owner: 'owner', title: 'The Midnight Library', type: 'read', done: true, createdAt: Date.now() - 600 },
        { id: '9', owner: 'maya', title: 'In the Mood for Love', type: 'watch', done: true, createdAt: Date.now() - 500 },
        { id: '10', owner: 'leo', title: 'In the Mood for Love', type: 'watch', done: false, createdAt: Date.now() - 400 },
      ],
      calendar: []
    };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
}
function saveDb(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let db = loadDb();

// ---------- Sessions (in-memory) ----------
const sessions = new Map(); // token -> {name, expires}
function parseCookies(req) {
  const h = req.headers.cookie || '';
  const out = {};
  h.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}
function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || Date.now() > s.expires) { sessions.delete(token); return null; }
  if (!db.users.includes(s.name)) return null;
  return s.name;
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Log in first' });
  req.user = u;
  next();
}
function requireOwner(req, res, next) {
  if (req.user !== OWNER_NAME && req.user !== db.users[0]) {
    return res.status(403).json({ error: 'Only the owner can do this' });
  }
  next();
}

app.use(express.json({ limit: '50kb' }));
// No caching in dev — Ctrl+Shift+R should never be needed
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// ---------- Helpers ----------
function cleanTitle(s){ return (s||'').trim().replace(/,\s*$/,'').replace(/\s+/g,' ').slice(0,120); }
function fuzzyKey(s){
  return (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\b(the|a|an)\b/g,' ')
    .replace(/[^a-z0-9 ]/g,' ')
    .replace(/\s+/g,' ').trim();
}
function levenshtein(a,b){
  const m=a.length,n=b.length,dp=Array.from({length:m+1},()=>Array(n+1).fill(0));
  for(let i=0;i<=m;i++)dp[i][0]=i; for(let j=0;j<=n;j++)dp[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return dp[m][n];
}
function fuzzyEqual(a,b){
  if(fuzzyKey(a)===fuzzyKey(b)) return true;
  const ka=fuzzyKey(a),kb=fuzzyKey(b);
  if(!ka||!kb) return false;
  const short=Math.min(ka.length,kb.length), long=Math.max(ka.length,kb.length);
  if(short>4 && short/long>0.82 && levenshtein(ka,kb)<=2) return true;
  return false;
}
function canonicalTitle(title, items){
  // return existing title spelling if fuzzy match exists (so variants group together)
  for(const it of items){ if(fuzzyEqual(title, it.title)) return it.title; }
  return cleanTitle(title);
}
const norm = s => fuzzyKey(s);

function computeTopPicks(items) {
  const groups = [];
  for (const it of items) {
    if (it.done) continue; // finished items drop out
    let g = groups.find(x => fuzzyEqual(x.title, it.title));
    if (!g) { g = { title: it.title.trim(), owners: [] }; groups.push(g); }
    if (!g.owners.includes(it.owner)) g.owners.push(it.owner);
  }
  const arr = groups.map(e => ({ ...e, count: e.owners.length }));
  return arr.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

function currentWeekSchedule(top) {
  if (!top.length) return null;
  if (!db.anchorMonday) {
    db.anchorMonday = iso(mondayOf(new Date()));
    saveDb(db);
  }
  const anchor = new Date(db.anchorMonday + 'T12:00:00');
  const nowMon = mondayOf(new Date());
  const weekIdx = Math.max(0, Math.floor((nowMon - anchor) / (7 * 24 * 60 * 60 * 1000)));
  const idx = weekIdx % top.length;
  const current = top[idx];
  const upNext = [];
  for (let i = 1; i <= 5 && i < top.length; i++) upNext.push(top[(idx + i) % top.length]);
  const sun = new Date(nowMon); sun.setDate(sun.getDate() + 6);
  return { current, upNext, weekIdx, weekStart: iso(nowMon), talk: iso(sun) };
}

function mondayOf(d = new Date()) {
  const x = new Date(d); x.setHours(0,0,0,0);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return x;
}
function iso(d) { return d.toISOString().slice(0,10); }

// ---------- API ----------
app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  if (!u) return res.json({ user: null });
  res.json({ user: u, isOwner: u === OWNER_NAME || u === db.users[0] });
});

app.post('/api/login', (req, res) => {
  const name = (req.body?.name || '').trim().toLowerCase();
  const password = req.body?.password || '';
  if (!name || !password) return res.status(400).json({ error: 'Name and password required' });
  if (password !== SHARED_PASSWORD) {
    return res.status(401).json({ error: 'Wrong shared password' });
  }
  if (!db.users.includes(name)) {
    return res.status(401).json({ error: 'Name not found — ask for your name to be added' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { name, expires: Date.now() + SESSION_TTL });
  res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL/1000}; SameSite=Lax`);
  res.json({ user: name, isOwner: name === OWNER_NAME || name === db.users[0] });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, (req, res) => {
  const top = computeTopPicks(db.items);
  const schedule = currentWeekSchedule(top);
  res.json({
    you: req.user,
    isOwner: req.user === OWNER_NAME || req.user === db.users[0],
    users: db.users,
    items: db.items.slice().sort((a,b) => b.createdAt - a.createdAt),
    top,
    schedule,
  });
});

// Items (movies only)
app.post('/api/items', requireAuth, (req, res) => {
  const title = cleanTitle(req.body?.title || '');
  if (!title) return res.status(400).json({ error: 'Title required' });
  if (db.items.some(i => i.owner === req.user && fuzzyEqual(i.title, title))) {
    return res.status(400).json({ error: 'You already have this on your list' });
  }
  const item = { id: crypto.randomUUID(), owner: req.user, title: canonicalTitle(title, db.items), done: false, createdAt: Date.now() };
  db.items.push(item); saveDb(db);
  res.json({ item });
});

// Bulk add: one title per line, trailing commas stripped
app.post('/api/items/bulk', requireAuth, (req, res) => {
  const raw = Array.isArray(req.body?.titles) ? req.body.titles : (req.body?.text||'').split(/\r?\n/);
  const seen = new Set();
  const added = [], skipped = [];
  for (const line of raw) {
    const t = cleanTitle(line);
    if (!t) continue;
    if (seen.has(norm(t))) continue;
    seen.add(norm(t));
    if (db.items.some(i => i.owner === req.user && fuzzyEqual(i.title, t))) { skipped.push(t); continue; }
    db.items.push({ id: crypto.randomUUID(), owner: req.user, title: canonicalTitle(t, db.items), done: false, createdAt: Date.now() });
    added.push(t);
  }
  saveDb(db);
  res.json({ added, skipped });
});

app.post('/api/items/:id/toggle', requireAuth, (req, res) => {
  const it = db.items.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'Not found' });
  if (it.owner !== req.user) return res.status(403).json({ error: 'Only owner can check their own list' });
  it.done = !it.done;
  if (it.done) it.watchedAt = Date.now();
  saveDb(db);
  res.json({ item: it });
});

app.delete('/api/items/:id', requireAuth, (req, res) => {
  const idx = db.items.findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (db.items[idx].owner !== req.user) return res.status(403).json({ error: 'Only owner can delete' });
  db.items.splice(idx, 1); saveDb(db);
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Friends Watch Club → http://localhost:${PORT}  (password: ${process.env.SHARED_PASSWORD ? 'from env' : 'crew123 default — change it!'})`));

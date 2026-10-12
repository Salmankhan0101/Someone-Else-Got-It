const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'items.json');


/* ---------- tiny JSON "database" ---------- */
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

function seed() {
  const mk = (type, title, category, description, location, name, phone, d) => ({
    id: crypto.randomUUID(), type, title, category, description, location,
    contactName: name, contactPhone: phone, photo: '', status: 'open',
    pinHash: hash('1234'), createdAt: daysAgo(d)
  });
  return [
    mk('lost', 'Black HP laptop bag', 'Bags', 'Black backpack with HP laptop charger and a blue notebook inside', 'Library', 'Rohit', '9876500001', 1),
    mk('found', 'Black backpack near stairs', 'Bags', 'Found a black bag with laptop charger, kept at library desk', 'Library', 'Library Desk', '9876500002', 0),
    mk('lost', 'Student ID card', 'Documents', 'Mahipal University ID card, name Priya Sharma, B.Tech CSE', 'Canteen', 'Priya', '9876500003', 2),
    mk('found', 'Samsung phone with blue cover', 'Electronics', 'Samsung phone, blue back cover, screen cracked at corner', 'Main Gate', 'Guard Room', '9876500004', 1),
    mk('lost', 'Silver water bottle', 'Other', 'Milton steel bottle with a sticker of a cat', 'Block B', 'Aman', '9876500005', 3)
  ];
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify(seed(), null, 2));

const load = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const save = (items) => fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2));
const publicView = ({ pinHash, ...rest }) => rest;

/* ---------- smart matching ---------- */
const STOP = new Set(['the','a','an','and','or','of','with','in','on','at','to','is','was','near','my','i','found','lost','kept','inside','has','have','it','for','from','by']);
const tokens = (t) => new Set(
  String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
);

function score(a, b) {
  const ta = tokens(`${a.title} ${a.description}`);
  const tb = tokens(`${b.title} ${b.description}`);
  let s = 0;
  ta.forEach((w) => { if (tb.has(w)) s += 1; });
  if (a.category === b.category) s += 2;
  if (a.location.toLowerCase() === b.location.toLowerCase()) s += 1;
  return s;
}

/* ---------- validation ---------- */
const CATEGORIES = ['Electronics', 'Documents', 'Bags', 'Keys', 'Clothing', 'Books', 'Other'];
function validate(b) {
  const errs = [];
  if (!['lost', 'found'].includes(b.type)) errs.push('Type must be lost or found');
  if (!b.title || b.title.trim().length < 3) errs.push('Title must be at least 3 characters');
  if (!CATEGORIES.includes(b.category)) errs.push('Pick a valid category');
  if (!b.location || !b.location.trim()) errs.push('Location is required');
  if (!b.contactName || !b.contactName.trim()) errs.push('Your name is required');
  if (!/^[0-9]{10}$/.test(String(b.contactPhone || ''))) errs.push('Phone must be 10 digits');
  if (!/^[0-9]{4}$/.test(String(b.pin || ''))) errs.push('PIN must be 4 digits');
  if (b.photo && (typeof b.photo !== 'string' || !b.photo.startsWith('data:image/'))) errs.push('Invalid photo');
  return errs;
}

/* ---------- tiny router (no dependencies) ---------- */
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 3e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function withPin(res, body, id, action) {
  const items = load();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return send(res, 404, { error: 'Item not found' });
  if (hash(body.pin) !== items[idx].pinHash) return send(res, 403, { error: 'Wrong PIN' });
  action(items, idx);
  save(items);
  send(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  if (p.startsWith('/api/')) {
    if (p === '/api/categories' && m === 'GET') return send(res, 200, CATEGORIES);

    if (p === '/api/stats' && m === 'GET') {
      const items = load();
      return send(res, 200, {
        lost: items.filter((i) => i.type === 'lost' && i.status === 'open').length,
        found: items.filter((i) => i.type === 'found' && i.status === 'open').length,
        returned: items.filter((i) => i.status === 'returned').length
      });
    }

    if (p === '/api/items' && m === 'GET') {
      const type = url.searchParams.get('type');
      const category = url.searchParams.get('category');
      const q = url.searchParams.get('q');
      let items = load();
      if (type) items = items.filter((i) => i.type === type);
      if (category) items = items.filter((i) => i.category === category);
      if (q) {
        const needle = q.toLowerCase();
        items = items.filter((i) => `${i.title} ${i.description} ${i.location}`.toLowerCase().includes(needle));
      }
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return send(res, 200, items.map(publicView));
    }

    if (p === '/api/items' && m === 'POST') {
      const b = await readBody(req);
      const errs = validate(b);
      if (errs.length) return send(res, 400, { errors: errs });
      const item = {
        id: crypto.randomUUID(), type: b.type,
        title: b.title.trim().slice(0, 80), category: b.category,
        description: String(b.description || '').trim().slice(0, 400),
        location: b.location.trim().slice(0, 60),
        contactName: b.contactName.trim().slice(0, 40),
        contactPhone: String(b.contactPhone), photo: b.photo || '',
        status: 'open', pinHash: hash(b.pin), createdAt: new Date().toISOString()
      };
      const items = load(); items.push(item); save(items);
      return send(res, 201, publicView(item));
    }

    let r = p.match(/^\/api\/items\/([^/]+)\/matches$/);
    if (r && m === 'GET') {
      const items = load();
      const me = items.find((i) => i.id === r[1]);
      if (!me) return send(res, 404, { error: 'Item not found' });
      const matches = items
        .filter((i) => i.type !== me.type && i.status === 'open')
        .map((i) => ({ item: publicView(i), score: score(me, i) }))
        .filter((x) => x.score >= 3)
        .sort((a, b) => b.score - a.score).slice(0, 3);
      return send(res, 200, matches);
    }

    r = p.match(/^\/api\/items\/([^/]+)\/resolve$/);
    if (r && m === 'PATCH') {
      const b = await readBody(req);
      return withPin(res, b, r[1], (items, i) => { items[i].status = 'returned'; });
    }

    r = p.match(/^\/api\/items\/([^/]+)$/);
    if (r && m === 'DELETE') {
      const b = await readBody(req);
      return withPin(res, b, r[1], (items, i) => { items.splice(i, 1); });
    }
    return send(res, 404, { error: 'Not found' });
  }

  // static files (flat folder, only allowed files are served)
  const ALLOWED = ['index.html', 'style.css', 'app.js'];
  const name = p === '/' ? 'index.html' : p.slice(1);
  if (!ALLOWED.includes(name)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(__dirname, name), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`\nKhoya-Paya chal gaya! Browser mein kholo: http://localhost:${PORT}\n`));

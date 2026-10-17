// Clash Board server
//  - serves the website
//  - saves ALL data on disk (data/db.json) and videos/photos as files (data/media/) so nothing is lost
//  - shares the data between everyone using the server (accounts, videos, comments, chat, servers, friends)
//  - keeps passwords on the server only (data/auth.json)
//  - relays voice-call signaling
// Run:  npm install   then   node server.js   ->  http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), { WebSocketServer } = require('ws');
const ROOT = __dirname, DATA = path.join(ROOT, 'data'), MEDIA = path.join(DATA, 'media'), F_DB = path.join(DATA, 'db.json'), F_AUTH = path.join(DATA, 'auth.json');
fs.mkdirSync(MEDIA, { recursive: true });
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const EMPTY = () => ({ users: {}, shorts: [], servers: [], leagues: [], clans: [], dms: {} });
let db = Object.assign(EMPTY(), load(F_DB, {})), auth = load(F_AUTH, {});
const timers = {};
const persist = (f, get) => { clearTimeout(timers[f]); timers[f] = setTimeout(() => { const t = f + '.tmp'; fs.writeFile(t, JSON.stringify(get()), e => { if (!e) fs.rename(t, f, () => {}); }); }, 250); };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.ico': 'image/x-icon' };
const PUBLIC = new Set(['index.html', 'style.css', 'app.js', 'board3d.js']);
const safeId = id => (/^\w[\w.-]{0,63}$/.test(id) ? id : null);
const body = (req, max) => new Promise((res, rej) => { const ch = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { rej(new Error('too big')); req.destroy(); } else ch.push(d); }); req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej); });
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Clash': '1' }); res.end(JSON.stringify(o)); };
function cleanDB(o) {
  if (!o || typeof o !== 'object') return null; const d = EMPTY();
  for (const k in d) if (o[k] != null && Array.isArray(o[k]) === Array.isArray(d[k]) && typeof o[k] === 'object') d[k] = o[k];
  Object.values(d.users).forEach(u => { if (u) delete u.pw; }); return d;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
    if (p === '/api/db' && req.method === 'GET') return json(res, 200, db);
    if (p === '/api/db' && req.method === 'PUT') {
      const d = cleanDB(JSON.parse((await body(req, 50e6)).toString())); if (!d) return json(res, 400, { ok: false });
      db = d; persist(F_DB, () => db);
      const msg = JSON.stringify({ t: 'db', db, from: req.headers['x-client'] || '' }); wss.clients.forEach(c => c.readyState === 1 && c.send(msg));
      return json(res, 200, { ok: true });
    }
    if (['/api/signup', '/api/login', '/api/passwd'].includes(p) && req.method === 'POST') {
      const b = JSON.parse((await body(req, 1e4)).toString()), u = String(b.u || ''), h = String(b.h || '');
      if (!/^[a-z0-9_]{6,19}$/.test(u) || !h || h.length > 40) return json(res, 400, { ok: false, err: 'Invalid request' });
      if (p === '/api/signup') { if (auth[u]) return json(res, 200, { ok: false, err: 'Username taken' }); auth[u] = h; persist(F_AUTH, () => auth); return json(res, 200, { ok: true }); }
      if (p === '/api/login') return json(res, 200, auth[u] && auth[u] === h ? { ok: true } : { ok: false, err: 'Wrong username or password' });
      const n = String(b.n || ''); if (auth[u] !== h) return json(res, 200, { ok: false, err: 'Old password is wrong' }); if (!n || n.length > 40) return json(res, 400, { ok: false });
      auth[u] = n; persist(F_AUTH, () => auth); return json(res, 200, { ok: true });
    }
    if (p.startsWith('/media/')) {
      const id = safeId(p.slice(7)); if (!id) { res.writeHead(400); return res.end(); } const f = path.join(MEDIA, id);
      if (req.method === 'PUT') { const b = await body(req, 400e6); fs.writeFileSync(f, b); fs.writeFileSync(f + '.type', String(req.headers['content-type'] || 'application/octet-stream').slice(0, 60)); return json(res, 200, { ok: true }); }
      if (req.method === 'DELETE') { fs.rmSync(f, { force: true }); fs.rmSync(f + '.type', { force: true }); return json(res, 200, { ok: true }); }
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      const st = fs.statSync(f), type = (() => { try { return fs.readFileSync(f + '.type', 'utf8'); } catch (e) { return 'application/octet-stream'; } })(), r = req.headers.range;
      if (r) { const m = /bytes=(\d*)-(\d*)/.exec(r) || [], s = m[1] ? +m[1] : 0, e = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1; res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 }); return fs.createReadStream(f, { start: s, end: e }).pipe(res); }
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'public,max-age=31536000,immutable' }); return fs.createReadStream(f).pipe(res);
    }
    // static files (only the website files, never the data folder or server.js)
    const rel = p === '/' ? 'index.html' : p.replace(/^\//, ''), f = path.join(ROOT, rel);
    if (!(PUBLIC.has(rel) || rel.startsWith('lib/')) || !f.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
    fs.readFile(f, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(data); });
  } catch (e) { res.writeHead(500); res.end('Server error'); }
});
const wss = new WebSocketServer({ server });
wss.on('connection', ws => ws.on('message', d => { wss.clients.forEach(c => { if (c !== ws && c.readyState === 1) c.send(d.toString()); }); }));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Clash Board is running. Your data is saved in: ' + DATA);
  console.log('  This computer:  http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).forEach(i => console.log('  Same Wi-Fi:     http://' + i.address + ':' + PORT + '  (voice calls need https or localhost)'));
});

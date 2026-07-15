const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const INDEX_FILE = path.join(__dirname, 'submissions.json');

// Parse JSON request bodies
app.use(express.json());

// Ensure directories exist
[UPLOAD_DIR, path.join(UPLOAD_DIR, 'videos'), path.join(UPLOAD_DIR, 'images')].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- Submissions store (in-memory + JSON persistence) ---
let submissions = [];
let listeners = []; // SSE clients

// Load from disk on startup
if (fs.existsSync(INDEX_FILE)) {
  try { submissions = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch(e) { submissions = []; }
}

function saveIndex() {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(submissions, null, 2));
}

function broadcast(item) {
  const data = JSON.stringify({ type: 'new_submission', item });
  listeners.forEach(fn => { try { fn.write('data: ' + data + '\n\n'); } catch(e) { /* client disconnected */ } });
}

function broadcastEvent(eventObj) {
  const data = JSON.stringify(eventObj);
  listeners.forEach(fn => { try { fn.write('data: ' + data + '\n\n'); } catch(e) { /* client disconnected */ } });
}

// --- SSE endpoint for real-time updates ---
app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  listeners.push(res);
  req.on('close', () => {
    listeners = listeners.filter(l => l !== res);
  });
});

// --- File upload config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const category = file.mimetype.startsWith('video') ? 'videos' : 'images';
    cb(null, path.join(UPLOAD_DIR, category));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = crypto.randomBytes(8).toString('hex') + ext;
    cb(null, name);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } }); // 5GB per file

// --- API: submit new content ---
app.post('/api/submit', upload.single('file'), (req, res) => {
  const { title, content } = req.body;
  const category = req.file ? (req.file.mimetype.startsWith('video') ? 'video' : 'image') : 'text';
  const ownerToken = crypto.randomBytes(8).toString('hex');

  const item = {
    id: crypto.randomBytes(6).toString('hex'),
    category,
    title: title || (category === 'text' ? '' : '未命名投稿'),
    content: req.body.content || '',
    file: req.file ? req.file.filename : null,
    mimeType: req.file ? req.file.mimetype : null,
    ownerToken,
    createdAt: new Date().toISOString(),
  };

  submissions.unshift(item);
  saveIndex();
  broadcast(item); // includes ownerToken for SSE
  // Set cookie so this browser becomes the owner
  res.cookie('owner_token', ownerToken, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  res.json({ ok: true, item });
});

// --- Simple cookie parser ---
function parseCookies(req) {
  const map = {};
  const header = req.headers.cookie;
  if (header) header.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k && v.length) map[k] = decodeURIComponent(v.join('='));
  });
  return map;
}

// --- API: list submissions ---
app.get('/api/submissions', (req, res) => {
  // Attach owner flag to each submission
  const cookies = parseCookies(req);
  const resSubs = submissions.map(s => ({
    ...s,
    isOwner: s.ownerToken === cookies.owner_token,
  }));
  res.json(resSubs);
});

// --- API: delete submission ---
app.delete('/api/submission/:id', (req, res) => {
  const cookies = parseCookies(req);
  const idx = submissions.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
  const sub = submissions[idx];
  if (sub.ownerToken !== cookies.owner_token) {
    return res.status(403).json({ ok: false, error: 'Only the owner can delete this submission' });
  }
  const removed = submissions.splice(idx, 1)[0];
  // Clean up uploaded file
  if (removed.file) {
    const filePath = path.join(UPLOAD_DIR, removed.category === 'video' ? 'videos' : 'images', removed.file);
    try { fs.unlinkSync(filePath); } catch(e) {}
  }
  saveIndex();
  broadcast({ type: 'deleted', id: removed.id });
  res.json({ ok: true });
});

// --- API: add comment ---
app.post('/api/submission/:id/comment', (req, res) => {
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ ok: false, error: 'Not found' });
  if (!sub.comments) sub.comments = [];
  const comment = {
    id: crypto.randomBytes(4).toString('hex'),
    text: req.body.text || '',
    createdAt: new Date().toISOString(),
  };
  sub.comments.push(comment);
  saveIndex();
  broadcast({ type: 'commented', id: sub.id, comment });
  res.json({ ok: true, comment });
});

// --- API: delete comment ---
app.delete('/api/submission/:id/comment/:cid', (req, res) => {
  const cookies = parseCookies(req);
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ ok: false, error: 'Not found' });
  if (!sub.comments) return res.json({ ok: true });
  const idx = sub.comments.findIndex(c => c.id === req.params.cid);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
  // Only owner can delete comments too
  if (sub.ownerToken !== cookies.owner_token) {
    return res.status(403).json({ ok: false, error: 'Only the owner can delete' });
  }
  sub.comments.splice(idx, 1);
  saveIndex();
  broadcast({ type: 'commentDeleted', id: sub.id, commentId: req.params.cid });
  res.json({ ok: true });
});

// --- API: append to submission (owner only) ---
app.post('/api/submission/:id/append', (req, res) => {
  const cookies = parseCookies(req);
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ ok: false, error: 'Not found' });
  if (sub.ownerToken !== cookies.owner_token) {
    return res.status(403).json({ ok: false, error: 'Only the owner can append' });
  }
  if (!sub.appends) sub.appends = [];
  const entry = {
    id: crypto.randomBytes(4).toString('hex'),
    text: req.body.text || '',
    createdAt: new Date().toISOString(),
  };
  sub.appends.push(entry);
  saveIndex();
  broadcast({ type: 'appended', id: sub.id, entry });
  res.json({ ok: true, entry });
});

// --- API: delete append ---
app.delete('/api/submission/:id/append/:aid', (req, res) => {
  const cookies = parseCookies(req);
  const sub = submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ ok: false, error: 'Not found' });
  if (!sub.appends) return res.json({ ok: true });
  const idx = sub.appends.findIndex(a => a.id === req.params.aid);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
  if (sub.ownerToken !== cookies.owner_token) {
    return res.status(403).json({ ok: false, error: 'Only the owner can delete' });
  }
  sub.appends.splice(idx, 1);
  saveIndex();
  broadcast({ type: 'appendDeleted', id: sub.id, appendId: req.params.aid });
  res.json({ ok: true });
});

// --- Serve static files ---
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/videos', express.static(path.join(UPLOAD_DIR, 'videos')));
app.use('/uploads/images', express.static(path.join(UPLOAD_DIR, 'images')));

// --- Start server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  吃瓜日报已启动: http://localhost:${PORT}`);
  console.log(`  上传目录: ${UPLOAD_DIR}\n`);
});

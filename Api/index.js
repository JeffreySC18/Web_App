
const express = require('express');
// Prefer IPv4 to avoid flaky IPv6 routes on some hosts
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) {}
const bcrypt = require('bcryptjs');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// Read Supabase config from environment for deployment safety
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_* key environment variables');
  // Exit early in hosted environments; in local dev, set .env
}
const BUCKET_NAME = 'recordings';
// Local transcription via Python (wav2vec2)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const USE_LOCAL_TRANSCRIBE = true;

const app = express();
app.use(express.json());
// CORS: allow localhost in dev; restrict via CORS_ORIGIN in production
const corsOrigin = process.env.NODE_ENV === 'production'
  ? (process.env.CORS_ORIGIN || undefined)
  : (process.env.CORS_ORIGIN || 'http://localhost:3000');
// Add preflight caching to cut down on OPTIONS requests; does not change POST runtime
const corsOptions = corsOrigin ? {
  origin: corsOrigin,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: ['authorization', 'content-type'],
  maxAge: 600, // seconds to cache preflight
  optionsSuccessStatus: 204
} : undefined;
app.use(cors(corsOptions));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Basic health endpoints
app.get('/', (_req, res) => {
  res.type('text/plain').send('OK');
});
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Local Wav2Vec2 helpers
async function runPython(args, timeoutMs = 180000) {
  const candidates = [['python3', args], ['python', args], ['py', ['-3', ...args]]];
  let lastErr = null;
  for (const [exe, a] of candidates) {
    try {
      const proc = spawn(exe, a, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { err += d.toString(); });
      const result = await new Promise((resolve, reject) => {
        const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} ; reject(new Error('python process timeout')); }, timeoutMs);
        proc.on('error', (e) => { clearTimeout(t); reject(e); });
        proc.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
      });
      return result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('python not found');
}

async function transcribeLocalFromBuffer(buffer, ext = 'webm') {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'w2v2-'));
  const audioPath = path.join(tmpBase, `audio.${ext}`);
  const outPath = path.join(tmpBase, 'out.json');
  const scriptPath = path.join(__dirname, 'transcription', 'wav2vec2_transcribe.py');
  await fsp.writeFile(audioPath, buffer);
  try {
    const r = await runPython([scriptPath, audioPath, outPath]);
    if (r.code !== 0) {
      try { const j = JSON.parse(r.out || '{}'); if (j.error) throw new Error(j.error); } catch {}
  throw new Error(r.err || r.out || 'wav2vec2 failed');
    }
    const jsonText = await fsp.readFile(outPath, 'utf-8');
    return JSON.parse(jsonText);
  } finally {
    try { await fsp.rm(tmpBase, { recursive: true, force: true }); } catch {}
  }
}

async function transcribeLocalFromUrl(url) {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'w2v2-'));
  const outPath = path.join(tmpBase, 'out.json');
  const scriptPath = path.join(__dirname, 'transcription', 'wav2vec2_transcribe.py');
  try {
    const r = await runPython([scriptPath, url, outPath]);
    if (r.code !== 0) {
      try { const j = JSON.parse(r.out || '{}'); if (j.error) throw new Error(j.error); } catch {}
  throw new Error(r.err || r.out || 'wav2vec2 failed');
    }
    const jsonText = await fsp.readFile(outPath, 'utf-8');
    return JSON.parse(jsonText);
  } finally {
    try { await fsp.rm(tmpBase, { recursive: true, force: true }); } catch {}
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Register user (now requires email and enforces unique username/email)
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  const problems = [];
  if (typeof username !== 'string' || !username.trim()) problems.push('Username is required');
  if (typeof email !== 'string' || !email.trim()) problems.push('Email is required');
  if (typeof password !== 'string' || !password) problems.push('Password is required');
  const trimmedEmail = (email || '').trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (trimmedEmail && !emailRegex.test(trimmedEmail)) problems.push('Email format is invalid');
  if (username && username.length < 3) problems.push('Username must be at least 3 characters');
  if (password && password.length < 6) problems.push('Password must be at least 6 characters');
  if (problems.length) {
    return res.status(400).json({ error: 'Validation failed', details: problems });
  }
  try {
    const normEmail = trimmedEmail.toLowerCase();
    const hash = bcrypt.hashSync(password, 10);
    // Existence check (case-insensitive for email)
    const { data: existingUser, error: existingErr } = await supabase
      .from('users')
      .select('id, username, email')
      .or(`username.eq.${username},email.ilike.${normEmail}`)
      .maybeSingle();
    if (existingErr) {
      console.error('Existing user check error:', existingErr);
    }
    if (existingUser) {
      const dupMsgs = [];
      if (existingUser.username === username) dupMsgs.push('Username already taken');
      if (existingUser.email && existingUser.email.toLowerCase() === normEmail) dupMsgs.push('Email already registered');
      return res.status(400).json({ error: 'Conflict', details: dupMsgs.length ? dupMsgs : ['User already exists'] });
    }
    const created_at = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from('users')
      .insert([{ username, email: normEmail, password_hash: hash, created_at }])
      .select('id, username, email, created_at')
      .single();
    if (insertError) {
      console.error('User insert error:', insertError);
      // Map common Postgres error codes
      if (insertError.code === '23505') {
        // Unique violation – best guess which constraint
        const msg = insertError.message || '';
        const dupDetails = [];
        if (/username/i.test(msg)) dupDetails.push('Username already taken');
        if (/email/i.test(msg)) dupDetails.push('Email already registered');
        return res.status(400).json({ error: 'Conflict', details: dupDetails.length ? dupDetails : ['Duplicate value'] });
      }
      if (insertError.code === '23502') {
  // Attempt to extract column from message
  const colMatch = /column "(.*)"/.exec(insertError.message || '');
  const col = colMatch ? colMatch[1] : 'unknown column';
  return res.status(400).json({ error: 'Missing required field', details: [`${col} was null or empty`] });
      }
      return res.status(500).json({ error: 'Registration failed', details: ['Unexpected database error'] });
    }
    const token = jwt.sign({ id: inserted.id, username: inserted.username, email: inserted.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user: inserted });
  } catch (e) {
    console.error('Register exception:', e);
    return res.status(500).json({ error: 'Server error during registration', details: ['Unhandled exception'] });
  }
});

// Login user (identifier can be username or email)
app.post('/login', async (req, res) => {
  const { username, identifier, password } = req.body;
  const loginId = identifier || username; // backward compatibility with old client sending 'username'
  if (!loginId || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    let query = supabase
      .from('users')
      .select('id, username, email, password_hash, created_at')
      .limit(1);
    if (loginId.includes('@')) {
      query = query.ilike('email', loginId.toLowerCase());
    } else {
      query = query.eq('username', loginId);
    }
    const { data: users, error } = await query;
    if (error || !users || users.length === 0) return res.status(400).json({ error: 'Invalid credentials' });
    const user = users[0];
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, created_at: user.created_at } });
  } catch (e) {
    console.error('Login exception:', e);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

// Upload a recording
app.post('/recordings', authenticateToken, upload.single('audio'), async (req, res) => {
  const userId = req.user.id;
  const label = req.body.label;
  const audio = req.file;
  const incomingFullText = req.body.full_text;
  const incomingWords = req.body.words ? (() => { try { return JSON.parse(req.body.words); } catch { return null; } })() : null;
  if (!label || !audio) {
    console.error('Missing label or audio:', { label, hasAudio: !!audio });
    return res.status(400).json({ error: 'Missing label or audio' });
  }
  // Upload to Supabase Storage
  const fileName = `${userId}_${Date.now()}.webm`;
  const { data: storageData, error: storageError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, audio.buffer, { contentType: 'audio/webm' });
  if (storageError) {
    console.error('Supabase storage upload error:', storageError);
    return res.status(500).json({ error: 'Failed to upload audio', details: storageError.message || storageError });
  }
  const audio_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${fileName}`;
  // Save metadata in DB
  const { data: recInsert, error: dbError } = await supabase
    .from('recordings')
    .insert([{ user_id: userId, label, audio_url }])
    .select('id')
    .single();
  if (dbError) {
    console.error('Supabase DB insert error:', dbError);
    return res.status(500).json({ error: 'Failed to save recording metadata', details: dbError.message || dbError });
  }
  // Kick off async transcription using python script
  if (incomingFullText) {
    const { error: tErr } = await supabase
      .from('transcripts')
      .insert([{ user_id: userId, recording_id: recInsert.id, full_text: incomingFullText, words: incomingWords }]);
    if (tErr) console.error('Insert provided transcript error:', tErr);
    return res.json({ success: true, audio_url, recording_id: recInsert.id, transcript_processing: false });
  }
  // Local wav2vec2 background transcription
  if (USE_LOCAL_TRANSCRIBE) {
    (async () => {
      try {
        // Allow storage to propagate and network to stabilize
        await new Promise(r => setTimeout(r, 1200));
        console.log(`[bg-transcribe-local] start user=${userId} rec=${recInsert.id}`);
        const t = await transcribeLocalFromUrl(audio_url);
        const text = t.full_text || '';
        const words = Array.isArray(t.words) ? t.words : [];
        const { error: tErr } = await supabase
          .from('transcripts')
          .insert([{ user_id: userId, recording_id: recInsert.id, full_text: text, words }]);
        if (tErr) console.error('Insert transcript error (local):', tErr);
        console.log(`[bg-transcribe-local] success user=${userId} rec=${recInsert.id} len=${text.length}`);
      } catch (e) {
        console.error('Background transcription error (local):', e);
      }
    })();
  return res.json({ success: true, audio_url, recording_id: recInsert.id, transcript_processing: true });
  }
  // No external fallback
  return res.json({ success: true, audio_url, recording_id: recInsert.id, transcript_processing: true });
});

// Get all recordings for the logged-in user
app.get('/recordings', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from('recordings')
    .select('id, label, audio_url, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to fetch recordings' });
  res.json(data);
});

// Rename a recording
app.put('/recordings/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const recId = req.params.id;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'Missing label' });
  const { error } = await supabase
    .from('recordings')
    .update({ label })
    .eq('id', recId)
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: 'Failed to rename recording' });
  res.json({ success: true });
});

// Delete a recording
app.delete('/recordings/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const recId = req.params.id;
  // Get audio_url for deletion
  const { data: rec, error: getError } = await supabase
    .from('recordings')
    .select('audio_url')
    .eq('id', recId)
    .eq('user_id', userId)
    .single();
  if (getError || !rec) return res.status(404).json({ error: 'Recording not found' });
  // Delete from storage
  const filePath = rec.audio_url.split(`/${BUCKET_NAME}/`)[1];
  await supabase.storage.from(BUCKET_NAME).remove([filePath]);
  // Delete metadata
  const { error } = await supabase
    .from('recordings')
    .delete()
    .eq('id', recId)
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: 'Failed to delete recording' });
  res.json({ success: true });
});

// Current user info route
app.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, created_at')
      .eq('id', req.user.id)
      .single();
    if (error || !user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (e) {
    console.error('Me route exception:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Immediate transcription endpoint (does not persist recording or transcript)
app.post('/transcribe', authenticateToken, upload.single('audio'), async (req, res) => {
  const audio = req.file;
  if (!audio) return res.status(400).json({ error: 'Missing audio' });
  try {
    const size = (audio.buffer && audio.buffer.length) || 0;
    console.log(`[transcribe-local-w2v2] received user=${req.user?.id} bytes=${size} type=${audio.mimetype}`);
    const type = (audio.mimetype || '').toLowerCase();
    let ext = 'webm';
    if (type.includes('mpeg') || type.includes('mp3')) ext = 'mp3';
    else if (type.includes('wav')) ext = 'wav';
    else if (type.includes('ogg')) ext = 'ogg';
    const result = await transcribeLocalFromBuffer(audio.buffer, ext);
    const text = result.full_text || '';
    const words = Array.isArray(result.words) ? result.words : [];
    console.log(`[transcribe-local-w2v2] success user=${req.user?.id} textLen=${text.length}`);
    return res.json({ full_text: text, words });
  } catch (e) {
    console.error('Immediate transcription error (local w2v2):', e);
    return res.status(500).json({ error: 'Local transcription failed' });
  }
});

// Transcripts list for user
app.get('/transcripts', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { data, error } = await supabase
    .from('transcripts')
    .select('id, recording_id, full_text, words, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to fetch transcripts' });
  res.json(data);
});

// Update transcript (edit full_text; optionally words if client recalculates)
app.put('/transcripts/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const id = req.params.id;
  const { full_text, words } = req.body;
  if (!full_text) return res.status(400).json({ error: 'Missing full_text' });
  const payload = { full_text, updated_at: new Date().toISOString() };
  if (words) payload.words = words;
  const { error } = await supabase
    .from('transcripts')
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) return res.status(500).json({ error: 'Failed to update transcript' });
  res.json({ success: true });
});

// Delete entire user account (requires password confirmation)
app.delete('/account', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  try {
    // Fetch user for password verification
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, password_hash')
      .eq('id', userId)
      .single();
    if (userErr || !user) return res.status(404).json({ error: 'User not found' });
    if (!bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Incorrect password' });

    // Get user recordings to remove from storage
    const { data: recs, error: recErr } = await supabase
      .from('recordings')
      .select('id, audio_url');
    if (recErr) console.error('Fetch recordings before delete error:', recErr);
    const userRecs = (recs || []).filter(r => r.audio_url && r.id); // filter only user-related will rely on policy, else add .eq('user_id', userId)

    // Filter only this user's recordings explicitly (safer)
    const { data: myRecs } = await supabase
      .from('recordings')
      .select('id, audio_url')
      .eq('user_id', userId);
    if (myRecs && myRecs.length) {
      const paths = myRecs.map(r => {
        const part = r.audio_url.split(`/recordings/`)[1];
        return part;
      }).filter(Boolean);
      if (paths.length) await supabase.storage.from(BUCKET_NAME).remove(paths);
    }

    // Delete transcripts
    const { error: delTransErr } = await supabase.from('transcripts').delete().eq('user_id', userId);
    if (delTransErr) console.error('Delete transcripts error:', delTransErr);
    // Delete recordings metadata
    const { error: delRecErr } = await supabase.from('recordings').delete().eq('user_id', userId);
    if (delRecErr) console.error('Delete recordings error:', delRecErr);
    // Delete user row
    const { error: delUserErr } = await supabase.from('users').delete().eq('id', userId);
    if (delUserErr) {
      console.error('Delete user error:', delUserErr);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('Account deletion exception:', e);
    return res.status(500).json({ error: 'Server error deleting account' });
  }
});

// Update username
app.put('/account/username', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { new_username } = req.body || {};
  if (typeof new_username !== 'string' || !new_username.trim()) return res.status(400).json({ error: 'Username required' });
  if (new_username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  try {
    // Check uniqueness
    const { data: existing } = await supabase.from('users').select('id').eq('username', new_username).maybeSingle();
    if (existing && existing.id !== userId) return res.status(400).json({ error: 'Username already taken' });
    const { error: updErr } = await supabase.from('users').update({ username: new_username }).eq('id', userId);
    if (updErr) return res.status(500).json({ error: 'Failed to update username' });
    return res.json({ success: true, username: new_username });
  } catch (e) {
    console.error('Username update error:', e);
    return res.status(500).json({ error: 'Server error updating username' });
  }
});

// Update password
app.put('/account/password', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password, confirm_password } = req.body || {};
  if (!current_password || !new_password || !confirm_password) return res.status(400).json({ error: 'All password fields required' });
  if (new_password !== confirm_password) return res.status(400).json({ error: 'New passwords do not match' });
  if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const { data: user, error: userErr } = await supabase.from('users').select('password_hash').eq('id', userId).single();
    if (userErr || !user) return res.status(404).json({ error: 'User not found' });
    if (!bcrypt.compareSync(current_password, user.password_hash)) return res.status(400).json({ error: 'Current password incorrect' });
    const newHash = bcrypt.hashSync(new_password, 10);
    const { error: updErr } = await supabase.from('users').update({ password_hash: newHash }).eq('id', userId);
    if (updErr) return res.status(500).json({ error: 'Failed to update password' });
    return res.json({ success: true });
  } catch (e) {
    console.error('Password update error:', e);
    return res.status(500).json({ error: 'Server error updating password' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});

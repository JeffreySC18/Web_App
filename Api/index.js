
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { spawn } = require('child_process');

const SUPABASE_URL = 'https://rhefugkfsymtbamhjkha.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoZWZ1Z2tmc3ltdGJhbWhqa2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwMjU2MTQsImV4cCI6MjA3MDYwMTYxNH0.vTkpHVUwWXxtmm-s0E-CUknbqdnlPWmHplERjEFoW5Q';
const BUCKET_NAME = 'recordings';
// (Optional) environment vars for transcription script path
const TRANSCRIBE_SCRIPT = process.env.TRANSCRIBE_SCRIPT || 'python transcription/whisper_transcribe.py';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(express.json());
app.use(cors());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const JWT_SECRET = 'your_jwt_secret'; // Change this in production

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
        return res.status(400).json({ error: 'Missing required field', details: ['A required field was null'] });
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
    console.error('Missing label or audio:', { label, audio });
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
  // Fallback: spawn async transcription if client did not provide
  try {
    const outJson = `transcript_${recInsert.id}.json`;
    const py = spawn('python', ['transcription/whisper_transcribe.py', audio_url, outJson], { cwd: process.cwd() });
    py.stderr.on('data', d => { console.error('Transcribe stderr:', d.toString()); });
    py.on('close', async (code) => {
      if (code !== 0) { console.error('Transcription process failed code', code); return; }
      try {
        const fs = require('fs');
        if (fs.existsSync(outJson)) {
          const raw = fs.readFileSync(outJson, 'utf-8');
          const parsed = JSON.parse(raw);
          const { full_text = '', words = [] } = parsed;
            const { error: tErr } = await supabase
              .from('transcripts')
              .insert([{ user_id: userId, recording_id: recInsert.id, full_text, words }]);
            if (tErr) console.error('Insert transcript error:', tErr);
          fs.unlink(outJson, () => {});
        }
      } catch (e) { console.error('Transcript post-process error:', e); }
    });
  } catch (e) { console.error('Failed to spawn transcription script:', e); }
  res.json({ success: true, audio_url, recording_id: recInsert.id, transcript_processing: true });
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
    const tmpName = `tmp_transcribe_${Date.now()}.webm`;
    const fs = require('fs');
    fs.writeFileSync(tmpName, audio.buffer);
    const { spawnSync } = require('child_process');
    const outJson = `tmp_transcript_${Date.now()}.json`;
    const run = spawnSync('python', ['transcription/whisper_transcribe.py', tmpName, outJson], { encoding: 'utf-8' });
    if (run.error) {
      console.error('Transcribe spawn error', run.error);
      return res.status(500).json({ error: 'Transcription process failed' });
    }
    if (run.status !== 0) {
      console.error('Transcribe non-zero exit', run.stdout, run.stderr);
      return res.status(500).json({ error: 'Transcription failed' });
    }
    const raw = fs.existsSync(outJson) ? fs.readFileSync(outJson, 'utf-8') : '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); } catch (e) { parsed = { full_text: '', words: [] }; }
    fs.unlink(tmpName, () => {});
    fs.unlink(outJson, () => {});
    return res.json({ full_text: parsed.full_text || '', words: parsed.words || [] });
  } catch (e) {
    console.error('Immediate transcription error:', e);
    return res.status(500).json({ error: 'Server error during transcription' });
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

app.listen(3001, () => {
  console.log('API server running on http://localhost:3001');
});

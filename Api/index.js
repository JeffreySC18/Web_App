
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://rhefugkfsymtbamhjkha.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJoZWZ1Z2tmc3ltdGJhbWhqa2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwMjU2MTQsImV4cCI6MjA3MDYwMTYxNH0.vTkpHVUwWXxtmm-s0E-CUknbqdnlPWmHplERjEFoW5Q';
const BUCKET_NAME = 'recordings';

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

// Register user
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const hash = bcrypt.hashSync(password, 10);
  // Check if user exists
  const { data: existing, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .single();
  if (existing) return res.status(400).json({ error: 'Username already exists' });
  // Insert user
  const { error } = await supabase
    .from('users')
    .insert([{ username, password_hash: hash }]);
  if (error) return res.status(500).json({ error: 'Failed to register user' });
  res.json({ success: true });
});

// Login user
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .single();
  if (error || !user) return res.status(400).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// Upload a recording
app.post('/recordings', authenticateToken, upload.single('audio'), async (req, res) => {
  const userId = req.user.id;
  const label = req.body.label;
  const audio = req.file;
  if (!label || !audio) return res.status(400).json({ error: 'Missing label or audio' });
  // Upload to Supabase Storage
  const fileName = `${userId}_${Date.now()}.webm`;
  const { data: storageData, error: storageError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(fileName, audio.buffer, { contentType: 'audio/webm' });
  if (storageError) return res.status(500).json({ error: 'Failed to upload audio' });
  const audio_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_NAME}/${fileName}`;
  // Save metadata in DB
  const { error: dbError } = await supabase
    .from('recordings')
    .insert([{ user_id: userId, label, audio_url }]);
  if (dbError) return res.status(500).json({ error: 'Failed to save recording metadata' });
  res.json({ success: true, audio_url });
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

app.listen(3001, () => {
  console.log('API server running on http://localhost:3001');
});

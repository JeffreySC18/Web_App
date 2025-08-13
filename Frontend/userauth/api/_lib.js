const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or service/anon key');
  return createClient(url, key);
}

function verifyAuth(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret);
  } catch (_) {
    return null;
  }
}

function parseMultipart(req) {
  const Busboy = require('busboy');
  return new Promise((resolve, reject) => {
    try {
      const bb = Busboy({ headers: req.headers });
      const fields = {};
      let fileObj = null;
      bb.on('file', (name, file, info) => {
        const { filename, mimeType } = info;
        const chunks = [];
        file.on('data', (d) => chunks.push(d));
        file.on('limit', () => reject(new Error('File size limit reached')));
        file.on('end', () => {
          fileObj = { buffer: Buffer.concat(chunks), filename, mimeType };
        });
      });
      bb.on('field', (name, val) => {
        fields[name] = val;
      });
      bb.on('error', reject);
      bb.on('finish', () => resolve({ fields, file: fileObj }));
      req.pipe(bb);
    } catch (e) { reject(e); }
  });
}

module.exports = { json, getSupabase, verifyAuth, parseMultipart };

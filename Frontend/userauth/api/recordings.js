const { json, getSupabase, verifyAuth, parseMultipart } = require('./_lib');

const BUCKET = process.env.SUPABASE_BUCKET || 'recordings';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Method not allowed' });
  }
  const user = verifyAuth(req);
  if (!user || !user.id) return json(res, 401, { error: 'Unauthorized' });

  try {
    const { fields, file } = await parseMultipart(req);
    const label = fields.label && String(fields.label).trim();
    if (!label || !file || !file.buffer?.length) return json(res, 400, { error: 'Missing label or audio' });

    const supabase = getSupabase();
    const ext = (file.mimeType && file.mimeType.includes('webm')) ? 'webm' : 'dat';
    const name = `${user.id}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(name, file.buffer, { contentType: file.mimeType || 'application/octet-stream' });
    if (upErr) return json(res, 500, { error: 'Failed to upload audio', details: upErr.message || String(upErr) });
    const audio_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${name}`;

    const { data: rec, error: dbErr } = await supabase
      .from('recordings')
      .insert([{ user_id: user.id, label, audio_url }])
      .select('id')
      .single();
    if (dbErr) return json(res, 500, { error: 'Failed to save recording', details: dbErr.message || String(dbErr) });

    // Note: no async transcription in serverless here
    return json(res, 200, { success: true, audio_url, recording_id: rec.id, transcript_processing: false });
  } catch (e) {
    return json(res, 500, { error: 'Server error', details: e?.message || String(e) });
  }
};

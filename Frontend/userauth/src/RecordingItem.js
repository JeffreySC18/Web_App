import React, { useState } from 'react';

function RecordingItem({ rec, token, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [newLabel, setNewLabel] = useState(rec.label);
  const [loading, setLoading] = useState(false);

  const handleRename = async () => {
    setLoading(true);
    try {
      await fetch(`http://localhost:3001/recordings/${rec.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ label: newLabel })
      });
      setEditing(false);
      onRename();
    } catch (err) {}
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this recording?')) return;
    setLoading(true);
    try {
      await fetch(`http://localhost:3001/recordings/${rec.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      onDelete();
    } catch (err) {}
    setLoading(false);
  };

  return (
    <div style={{ background: '#f7f7fa', borderRadius: 12, boxShadow: '0 2px 8px rgba(106,130,251,0.08)', padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ flex: 1 }}>
        {editing ? (
          <input
            type="text"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            style={{ fontWeight: 'bold', color: '#fc5c7d', fontSize: 18, borderRadius: 8, border: '1px solid #d1d5db', padding: '4px 8px', width: '80%' }}
          />
        ) : (
          <div style={{ fontWeight: 'bold', color: '#fc5c7d', fontSize: 18 }}>{rec.label}</div>
        )}
        <div style={{ fontSize: 12, color: '#888' }}>{new Date(rec.created_at).toLocaleString()}</div>
      </div>
  {/* Use direct public Supabase storage URL saved in recording metadata */}
  <audio controls src={rec.audio_url} style={{ width: 180 }} />
      {editing ? (
        <>
          <button onClick={handleRename} disabled={loading || !newLabel} style={{ marginRight: 8 }}>Save</button>
          <button onClick={() => setEditing(false)} disabled={loading}>Cancel</button>
        </>
      ) : (
        <>
          <button onClick={() => setEditing(true)} style={{ marginRight: 8 }}>Rename</button>
          <button onClick={handleDelete} disabled={loading}>Delete</button>
        </>
      )}
    </div>
  );
}

export default RecordingItem;

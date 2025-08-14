import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from './config';
import AuthForm from './AuthForm';
import RecordingItem from './RecordingItem';
// Transcript history toggle
import './App.css';

function App() {
  const [token, setToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null); // holds id, username, email
  const [showLogin, setShowLogin] = useState(true);

  const handleAuth = (data) => {
    if (data.token) {
      setToken(data.token);
      if (data.user) setCurrentUser(data.user);
    } else setShowLogin(true);
  };

  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioURL, setAudioURL] = useState(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptWords, setTranscriptWords] = useState([]); // word-level timings
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState('');
  // Remove chunks from state, use local variable
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [showTranscripts, setShowTranscripts] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [loadingTranscripts, setLoadingTranscripts] = useState(false);
  // Transcript editing state
  const [editingTranscriptId, setEditingTranscriptId] = useState(null);
  const [editingTranscriptText, setEditingTranscriptText] = useState('');
  const [editingTranscriptSaving, setEditingTranscriptSaving] = useState(false);
  // Tabs: 'record' | 'library' | 'settings'
  const [activeTab, setActiveTab] = useState('record');
  // Settings form state
  const [newUsername, setNewUsername] = useState('');
  const [usernameUpdating, setUsernameUpdating] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwUpdating, setPwUpdating] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [expandedRecordingIds, setExpandedRecordingIds] = useState(new Set());

  const toggleExpand = (id) => {
    setExpandedRecordingIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // Recording duration and simple indicator
  const [elapsedTime, setElapsedTime] = useState(0);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const recordedBlobRef = useRef(null);
  const startTimer = () => {
    setElapsedTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedTime(((Date.now() - start) / 1000));
    }, 100);
  };
  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  
  const startRecording = async () => {
    setAudioURL(null);
    setLabel('');
  startTimer();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new window.MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        recordedBlobRef.current = blob;
        setAudioURL(URL.createObjectURL(blob));
        chunksRef.current = [];
    stopTimer();
      };
      setMediaRecorder(recorder);
      chunksRef.current = [];
      recorder.start(100); // timeslice for more frequent dataavailable
      setRecording(true);
    } catch (err) {
      alert('Microphone access denied or not available.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch {} }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    stopTimer();
    setRecording(false);
  };

  // Discard current (in-memory) recording & transcript before upload
  const discardCurrent = () => {
    // If still recording, stop streams silently
    if (recording) {
      try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch {}
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    }
    chunksRef.current = [];
    setAudioURL(null);
  recordedBlobRef.current = null;
    setTranscriptText('');
    setTranscriptWords([]);
    setLabel('');
    setRecording(false);
    stopTimer();
  };

  useEffect(() => {
    return () => { // unmount cleanup
      stopRecording();
      stopTimer();
    };
  }, []);

  // Upload recording to backend
  const uploadRecording = async () => {
    if (!audioURL || !label) return;
    setUploading(true);
    try {
  const blob = recordedBlobRef.current || (await fetch(audioURL).then(r => r.blob()));
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('label', label);
      if (transcriptText) formData.append('full_text', transcriptText);
      if (transcriptWords && transcriptWords.length > 0) {
        try { formData.append('words', JSON.stringify(transcriptWords)); } catch {}
      }
  const res = await fetch(`${API_BASE}/recordings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setAudioURL(null);
        setLabel('');
        setTranscriptText('');
        setTranscriptWords([]);
        fetchRecordings();
        // If transcript processing flagged, poll transcripts
        if (data.transcript_processing) {
          setShowTranscripts(true);
          let attempts = 0;
          const poll = async () => {
            attempts++;
            try {
              const resT = await fetch(`${API_BASE}/transcripts`, { headers: { 'Authorization': `Bearer ${token}` } });
              const arr = await resT.json();
              if (Array.isArray(arr)) setTranscripts(arr);
              const found = Array.isArray(arr) && arr.some(t => t.recording_id === data.recording_id);
              if (!found && attempts < 15) setTimeout(poll, 4000);
            } catch {}
          };
          setTimeout(poll, 4000);
        } else {
          // Immediate transcript already saved; refresh history once
          setShowTranscripts(true);
          fetchTranscripts();
        }
      }
    } catch (err) {
      alert('Failed to upload recording');
    }
    setUploading(false);
  };

  // Fetch user's recordings from backend
  const fetchRecordings = useCallback(async () => {
    try {
  const res = await fetch(`${API_BASE}/recordings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Fetch recordings failed:', data);
        setRecordings([]);
        return;
      }
      if (Array.isArray(data)) {
        setRecordings(data);
      } else {
        console.error('Unexpected recordings response (not array):', data);
        setRecordings([]);
      }
    } catch (err) {
      console.error('Error fetching recordings:', err);
      setRecordings([]);
    }
  }, [token]);

  const fetchTranscripts = useCallback( async () => {
    if (!token) return;
    setLoadingTranscripts(true);
    try {
  const res = await fetch(`${API_BASE}/transcripts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setTranscripts(data);
      else setTranscripts([]);
    } catch (e) {
      console.error('Fetch transcripts error', e);
      setTranscripts([]);
    }
    setLoadingTranscripts(false);
  }, [token]);

  const handleDeleteRecording = async (id) => {
    if (!window.confirm('Delete this recording? This will remove its transcript too.')) return;
    try {
  await fetch(`${API_BASE}/recordings/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) {}
    await fetchRecordings();
    await fetchTranscripts();
  };

  useEffect(() => {
    if (showTranscripts) fetchTranscripts();
  }, [showTranscripts, fetchTranscripts]);

  useEffect(() => {
    if (token) fetchRecordings();
  }, [token, fetchRecordings]);

  const runImmediateTranscription = useCallback( async () => {
    if (!audioURL) return;
    setTranscribing(true);
    setTranscribeError('');
    try {
      const blob = recordedBlobRef.current || (await fetch(audioURL).then(r => r.blob()));
      console.log('[ui] starting immediate transcription, blob size =', blob.size);
      const formData = new FormData();
      formData.append('audio', blob, 'temp.webm');
  // Add a client-side timeout to avoid indefinite spinner
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 45000);
  const res = await fetch(`${API_BASE}/transcribe`, {
        method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
    signal: controller.signal
      });
  clearTimeout(t);
      console.log('[ui] /transcribe response status =', res.status);
      const data = await res.json();
      if (res.ok && data.full_text !== undefined) {
        setTranscriptText(data.full_text);
        setTranscriptWords(Array.isArray(data.words) ? data.words : []);
      } else {
        console.error('Transcription failed', data);
        setTranscribeError(data?.error || 'Transcription failed');
      }
    } catch (e) {
      console.error('Immediate transcription error', e);
      if (e?.name === 'AbortError') setTranscribeError('Transcription timed out');
      else setTranscribeError('Network error during transcription');
    }
    setTranscribing(false);
  }, [audioURL, token]);

  // Trigger immediate transcription when audioURL becomes available
  useEffect(() => {
    if (audioURL && token) runImmediateTranscription();
  }, [audioURL, token, runImmediateTranscription]);

  // Fetch user info if token set but no user (backward compatibility)
  useEffect(() => {
    const fetchMe = async () => {
      if (token && !currentUser) {
        try {
          const res = await fetch(`${API_BASE}/me`, { headers: { 'Authorization': `Bearer ${token}` } });
          const data = await res.json();
          if (res.ok) setCurrentUser(data);
        } catch {}
      }
    };
    fetchMe();
  }, [token, currentUser]);

  if (token) {
    return (
      <div className="auth-container">
        <div className="auth-graphic">
          <svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>
        </div>
        <h1>Welcome{currentUser && currentUser.username ? `, ${currentUser.username}` : '!'}!</h1>
        {currentUser && currentUser.email && (
          <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>Email: {currentUser.email}</div>
        )}
        <div className="tabs" style={{ display: 'flex', gap: 12, margin: '16px 0 8px' }}>
          <button
            className={`btn btn-sm ${activeTab === 'record' ? '' : 'btn-outline'}`}
            onClick={() => setActiveTab('record')}
          >Record</button>
          <button
            className={`btn btn-sm ${activeTab === 'library' ? '' : 'btn-outline'}`}
            onClick={() => { setActiveTab('library'); fetchRecordings(); fetchTranscripts(); }}
          >Library</button>
          <button
            className={`btn btn-sm ${activeTab === 'settings' ? '' : 'btn-outline'}`}
            onClick={() => setActiveTab('settings')}
          >Settings</button>
        </div>
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <button className="btn btn-outline btn-sm" onClick={() => { setToken(null); setCurrentUser(null); setShowLogin(true); }}>Logout</button>
  </div>
  {activeTab === 'record' && (
  <div style={{ marginTop: 16 }} className="btn-group">
          <button className="btn btn-lg" onClick={startRecording} disabled={recording}>
            {recording ? 'Recording...' : 'Add Recording'}
          </button>
          <button className="btn btn-secondary btn-lg" onClick={stopRecording} disabled={!recording}>
            Stop
          </button>
        </div>
  )}
  {activeTab === 'record' && (audioURL || recording) && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <h3>Your Recording:</h3>
            {recording && (
              <div style={{ margin: '12px auto 8px', maxWidth: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#444' }}>
                  <span className="record-dot" />
                  <span>Recording...</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '1px', color: '#6a82fb' }}>{elapsedTime.toFixed(1)}s</div>
              </div>
            )}
            {!recording && audioURL && <audio controls src={audioURL} />}
            <div style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder="Enter a label for your recording"
                value={label}
                onChange={e => setLabel(e.target.value)}
                style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', width: '80%' }}
              />
            </div>
            <button onClick={uploadRecording} disabled={!audioURL || !label || uploading || transcribing || recording} className="btn btn-lg" style={{ marginTop: 16 }}>
              {transcribing ? 'Waiting for transcript…' : (uploading ? 'Uploading...' : 'Save Recording')}
            </button>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={(!audioURL && !recording) || uploading}
                onClick={discardCurrent}
                style={{ width: '60%' }}
              >Discard</button>
            </div>
            <div style={{ marginTop: 24, textAlign: 'left' }}>
              <h3 style={{ marginBottom: 8 }}>Transcript (editable)</h3>
              {transcribing && (
                <div className="transcribe-loading">
                  <div className="spinner spinner-inline" />
                  <div>
                    <strong>Transcribing audio</strong><br />
                    This can take a moment...
                  </div>
                </div>
              )}
              {!transcribing && transcribeError && (
                <div style={{ margin: '8px 0', color: '#b91c1c', fontSize: 13 }}>{transcribeError}</div>
              )}
              <textarea
                value={transcriptText}
                onChange={e => setTranscriptText(e.target.value)}
                placeholder={transcribing ? 'Transcribing...' : 'Transcript will appear here'}
                disabled={transcribing}
                style={{ width: '100%', minHeight: 150, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'monospace', background: transcribing ? '#f3f4f6' : 'white', opacity: transcribing ? 0.7 : 1 }}
              />
            </div>
          </div>
        )}
        {activeTab === 'library' && (
          <div style={{ marginTop: 24, width: '100%' }}>
            <h2 style={{ color: '#6a82fb', marginBottom: 16 }}>Your Library</h2>
            {recordings.length === 0 && <p>No recordings yet.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recordings.map(rec => {
                const expanded = expandedRecordingIds.has(rec.id);
                const transcript = transcripts.find(t => t.recording_id === rec.id);
                const isEditing = editingTranscriptId && transcript && editingTranscriptId === transcript.id;
                return (
                  <div key={rec.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', gap: 12 }} onClick={() => toggleExpand(rec.id)}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontWeight: 600, color: '#334155' }}>{rec.label}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{new Date(rec.created_at).toLocaleString()}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => { e.stopPropagation(); }}>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDeleteRecording(rec.id)}>Delete</button>
                        <button className="btn btn-outline btn-sm" onClick={() => toggleExpand(rec.id)}>{expanded ? 'Hide' : 'View'} {expanded ? '▲' : '▼'}</button>
                      </div>
                    </div>
                    {expanded && (
                      <div style={{ padding: '0 14px 14px' }}>
                        <audio controls src={rec.audio_url} style={{ width: '100%', marginTop: 8 }} />
                        <div style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h4 style={{ margin: 0, color: '#6a82fb' }}>Transcript</h4>
                            {transcript && !isEditing && (
                              <button className="btn btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); setEditingTranscriptId(transcript.id); setEditingTranscriptText(transcript.full_text); }}>Edit</button>
                            )}
                          </div>
                          {!transcript && <p style={{ fontSize: 14, color: '#888', marginTop: 8 }}>No transcript yet.</p>}
                          {transcript && isEditing && (
                            <>
                              <textarea
                                value={editingTranscriptText}
                                onChange={e => setEditingTranscriptText(e.target.value)}
                                style={{ width: '100%', marginTop: 8, minHeight: 140, borderRadius: 8, border: '1px solid #d1d5db', padding: 8 }}
                                onClick={e => e.stopPropagation()}
                              />
                              <div className="btn-group" style={{ marginTop: 10 }}>
                                <button
                                  className="btn btn-sm"
                                  disabled={editingTranscriptSaving}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    setEditingTranscriptSaving(true);
                                    try {
                                      await fetch(`${API_BASE}/transcripts/${transcript.id}`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                        body: JSON.stringify({ full_text: editingTranscriptText })
                                      });
                                      await fetchTranscripts();
                                      setEditingTranscriptId(null);
                                      setEditingTranscriptText('');
                                    } catch {}
                                    setEditingTranscriptSaving(false);
                                  }}
                                >
                                  {editingTranscriptSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  disabled={editingTranscriptSaving}
                                  onClick={(e) => { e.stopPropagation(); setEditingTranscriptId(null); setEditingTranscriptText(''); }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}
                          {transcript && !isEditing && (
                            <textarea
                              disabled
                              value={transcript.full_text}
                              style={{ width: '100%', marginTop: 8, minHeight: 140, borderRadius: 8, border: '1px solid #e5e7eb', padding: 8, background: '#f8f9fb', color: '#374151' }}
                              onClick={e => e.stopPropagation()}
                            />
                          )}
                          {transcript && transcript.words && transcript.words.length > 0 && (
                            <details style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                              <summary style={{ cursor: 'pointer' }}>Word timings ({transcript.words.length})</summary>
                              <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12, marginTop: 6 }}>
                                {transcript.words.slice(0,200).map((w,i) => (
                                  <span key={i} style={{ marginRight: 6 }}>{w.word}<sup>{w.start?.toFixed?.(1)}</sup></span>
                                ))}
                                {transcript.words.length > 200 && <div>... truncated ...</div>}
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {activeTab === 'settings' && (
          <div style={{ marginTop: 24, width: '100%', textAlign: 'left' }}>
            <h2 style={{ color: '#6a82fb', marginBottom: 16 }}>Account Settings</h2>
            {settingsMsg && <div style={{ marginBottom: 12, fontSize: 13, color: '#1d4ed8', whiteSpace: 'pre-line' }}>{settingsMsg}</div>}
            <section style={{ marginBottom: 32 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Change Username</h3>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="New username"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  style={{ padding: '8px', borderRadius: 8, border: '1px solid #d1d5db' }}
                />
                <button
                  className="btn btn-sm"
                  disabled={usernameUpdating || !newUsername.trim() || newUsername.trim() === currentUser?.username}
                  onClick={async () => {
                    setSettingsMsg('');
                    setUsernameUpdating(true);
                    try {
                      const res = await fetch(`${API_BASE}/account/username`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ new_username: newUsername.trim() })
                      });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setCurrentUser(u => ({ ...u, username: data.username }));
                        setSettingsMsg('Username updated');
                      } else {
                        setSettingsMsg(data.error || 'Failed to update username');
                      }
                    } catch {
                      setSettingsMsg('Server error updating username');
                    }
                    setUsernameUpdating(false);
                  }}
                >{usernameUpdating ? 'Updating...' : 'Save'}</button>
              </div>
            </section>
            <section style={{ marginBottom: 32 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Change Password</h3>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
                <input type="password" placeholder="Current password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} />
                <input type="password" placeholder="New password" value={pwNew} onChange={e => setPwNew(e.target.value)} />
                <input type="password" placeholder="Confirm new password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} />
                <button
                  className="btn btn-sm"
                  disabled={pwUpdating || !pwCurrent || !pwNew || !pwConfirm}
                  onClick={async () => {
                    setSettingsMsg('');
                    if (pwNew !== pwConfirm) { setSettingsMsg('New passwords do not match'); return; }
                    setPwUpdating(true);
                    try {
                      const res = await fetch(`${API_BASE}/account/password`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew, confirm_password: pwConfirm })
                      });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setSettingsMsg('Password updated');
                        setPwCurrent(''); setPwNew(''); setPwConfirm('');
                      } else setSettingsMsg(data.error || 'Failed to update password');
                    } catch {
                      setSettingsMsg('Server error updating password');
                    }
                    setPwUpdating(false);
                  }}
                >{pwUpdating ? 'Updating...' : 'Save'}</button>
              </div>
            </section>
            <section>
              <h3 style={{ margin: 0, fontSize: 18, color: '#b91c1c' }}>Danger Zone</h3>
              <p style={{ fontSize: 13, color: '#555' }}>Delete your account and all associated recordings & transcripts.</p>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  const pw = window.prompt('Enter your password to permanently delete your account. This cannot be undone.');
                  if (!pw) return;
                  if (!window.confirm('Are you absolutely sure? This will delete all recordings and transcripts.')) return;
                  (async () => {
                    try {
                      const res = await fetch(`${API_BASE}/account`, {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ password: pw })
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.ok && data.success) {
                        alert('Account deleted.');
                        setToken(null); setCurrentUser(null); setShowLogin(true);
                      } else {
                        setSettingsMsg(data?.error || 'Failed to delete account');
                      }
                    } catch (e) {
                      setSettingsMsg('Server error deleting account');
                    }
                  })();
                }}
              >Delete Account</button>
            </section>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-graphic">
        <svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>
      </div>
      <div className="auth-header">
        <button onClick={() => setShowLogin(true)} disabled={showLogin}>Login</button>
        <button onClick={() => setShowLogin(false)} disabled={!showLogin}>Register</button>
      </div>
      {showLogin ? (
        <AuthForm type="login" onAuth={handleAuth} />
      ) : (
        <AuthForm type="register" onAuth={handleAuth} />
      )}
    </div>
  );
}

export default App;

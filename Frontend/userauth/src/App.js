import React, { useState, useEffect, useCallback } from 'react';
import AuthForm from './AuthForm';
import RecordingItem from './RecordingItem';
// Transcript history toggle
import './App.css';

function App() {
  const [token, setToken] = useState(null);
  const [showLogin, setShowLogin] = useState(true);

  const handleAuth = (data) => {
    if (data.token) setToken(data.token);
    else setShowLogin(true);
  };

  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioURL, setAudioURL] = useState(null);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  // Remove chunks from state, use local variable
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recordings, setRecordings] = useState([]);
  const [showTranscripts, setShowTranscripts] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [loadingTranscripts, setLoadingTranscripts] = useState(false);

  let localChunks = [];
  const startRecording = async () => {
    setAudioURL(null);
    setLabel('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new window.MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) localChunks.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(localChunks, { type: 'audio/webm' });
        setAudioURL(URL.createObjectURL(blob));
      };
      setMediaRecorder(recorder);
      localChunks = [];
      recorder.start();
      setRecording(true);
    } catch (err) {
      alert('Microphone access denied or not available.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
    }
  };

  // Upload recording to backend
  const uploadRecording = async () => {
    if (!audioURL || !label) return;
    setUploading(true);
    try {
      const blob = await fetch(audioURL).then(r => r.blob());
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('label', label);
      if (transcriptText) formData.append('full_text', transcriptText);
      const res = await fetch('http://localhost:3001/recordings', {
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
        fetchRecordings();
        // If transcript processing flagged, poll transcripts
        if (data.transcript_processing) {
          setShowTranscripts(true);
          let attempts = 0;
            const poll = async () => {
              attempts++;
              await fetchTranscripts();
              const found = transcripts.some(t => t.recording_id === data.recording_id);
              if (!found && attempts < 15) {
                setTimeout(poll, 4000);
              }
            };
          setTimeout(poll, 4000);
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
      const res = await fetch('http://localhost:3001/recordings', {
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
      const res = await fetch('http://localhost:3001/transcripts', {
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

  useEffect(() => {
    if (showTranscripts) fetchTranscripts();
  }, [showTranscripts, fetchTranscripts]);

  useEffect(() => {
    if (token) fetchRecordings();
  }, [token, fetchRecordings]);

  const runImmediateTranscription = useCallback( async () => {
    if (!audioURL) return;
    setTranscribing(true);
    try {
      const blob = await fetch(audioURL).then(r => r.blob());
      const formData = new FormData();
      formData.append('audio', blob, 'temp.webm');
      const res = await fetch('http://localhost:3001/transcribe', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.full_text !== undefined) {
        setTranscriptText(data.full_text);
      } else {
        console.error('Transcription failed', data);
      }
    } catch (e) {
      console.error('Immediate transcription error', e);
    }
    setTranscribing(false);
  }, [audioURL, token]);

  // Trigger immediate transcription when audioURL becomes available
  useEffect(() => {
    if (audioURL && token) runImmediateTranscription();
  }, [audioURL, token, runImmediateTranscription]);

  if (token) {
    return (
      <div className="auth-container">
        <div className="auth-graphic">
          <svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 8 1.34 8 4v2H4v-2c0-2.66 5.3-4 8-4zm0-2a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>
        </div>
        <h1>Welcome!</h1>
        <p>You are logged in.</p>
        <button onClick={() => { setToken(null); setShowLogin(true); }}>Logout</button>
        <div style={{ marginTop: 32 }}>
          <button onClick={startRecording} disabled={recording} style={{ marginRight: 10 }}>
            Add Recording
          </button>
          <button onClick={stopRecording} disabled={!recording}>
            Stop Recording
          </button>
          <button style={{ marginLeft: 10 }} onClick={() => setShowTranscripts(s => !s)}>
            {showTranscripts ? 'Hide Transcript History' : 'Transcript History'}
          </button>
        </div>
        {audioURL && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <h3>Your Recording:</h3>
            <audio controls src={audioURL} />
            <div style={{ marginTop: 8 }}>
              <input
                type="text"
                placeholder="Enter a label for your recording"
                value={label}
                onChange={e => setLabel(e.target.value)}
                style={{ padding: '8px', borderRadius: '8px', border: '1px solid #d1d5db', width: '80%' }}
              />
            </div>
            <button onClick={uploadRecording} disabled={!label || uploading} style={{ marginTop: 10 }}>
              {uploading ? 'Uploading...' : 'Save Recording'}
            </button>
            <div style={{ marginTop: 24, textAlign: 'left' }}>
              <h3 style={{ marginBottom: 8 }}>Transcript (editable)</h3>
              {transcribing && <p>Transcribing...</p>}
              <textarea
                value={transcriptText}
                onChange={e => setTranscriptText(e.target.value)}
                placeholder={transcribing ? 'Transcribing...' : 'Transcript will appear here'}
                style={{ width: '100%', minHeight: 150, padding: 10, borderRadius: 8, border: '1px solid #d1d5db', fontFamily: 'monospace' }}
              />
            </div>
          </div>
        )}
        <div style={{ marginTop: 40 }}>
          <h2 style={{ color: '#6a82fb', marginBottom: 16 }}>Your Recordings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {recordings.length === 0 && <p>No recordings yet.</p>}
            {recordings.map(rec => (
              <RecordingItem
                key={rec.id}
                rec={rec}
                token={token}
                onRename={fetchRecordings}
                onDelete={fetchRecordings}
              />
            ))}
          </div>
        </div>
        {showTranscripts && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ color: '#6a82fb', marginBottom: 16 }}>Transcript History</h2>
            {loadingTranscripts && <p>Loading transcripts...</p>}
            {!loadingTranscripts && transcripts.length === 0 && <p>No transcripts yet.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {transcripts.map(t => (
                <div key={t.id} style={{ padding: 16, background: '#fff', borderRadius: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
                  <small style={{ color: '#6b7280' }}>Recording #{t.recording_id}</small>
                  <textarea
                    defaultValue={t.full_text}
                    style={{ width: '100%', marginTop: 8, minHeight: 120, borderRadius: 8, border: '1px solid #d1d5db', padding: 8 }}
                    onBlur={async (e) => {
                      const full_text = e.target.value;
                      await fetch(`http://localhost:3001/transcripts/${t.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ full_text })
                      });
                    }}
                  />
                  {t.words && Array.isArray(t.words) && t.words.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer' }}>Word timings ({t.words.length})</summary>
                      <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12, marginTop: 6 }}>
                        {t.words.slice(0,200).map((w,i) => (
                          <span key={i} style={{ marginRight: 6 }}>{w.word}<sup>{w.start?.toFixed?.(1)}</sup></span>
                        ))}
                        {t.words.length > 200 && <div>... truncated ...</div>}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
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

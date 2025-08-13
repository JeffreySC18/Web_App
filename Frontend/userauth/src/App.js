import React, { useState, useEffect } from 'react';
import AuthForm from './AuthForm';
import RecordingItem from './RecordingItem';
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
  // Remove chunks from state, use local variable
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recordings, setRecordings] = useState([]);

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
        fetchRecordings();
      }
    } catch (err) {
      alert('Failed to upload recording');
    }
    setUploading(false);
  };

  // Fetch user's recordings from backend
  const fetchRecordings = async () => {
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
  };

  useEffect(() => {
    if (token) fetchRecordings();
  }, [token]);

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

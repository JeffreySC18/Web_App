import React, { useState } from 'react';
import AuthForm from './AuthForm';
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
  const [chunks, setChunks] = useState([]);

  const startRecording = async () => {
    setAudioURL(null);
    setChunks([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new window.MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) setChunks(prev => [...prev, e.data]);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioURL(URL.createObjectURL(blob));
      };
      setMediaRecorder(recorder);
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
          <div style={{ marginTop: 24 }}>
            <h3>Your Recording:</h3>
            <audio controls src={audioURL} />
            <a href={audioURL} download="recording.webm" style={{ display: 'block', marginTop: 8 }}>Download</a>
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

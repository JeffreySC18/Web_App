import React, { useState } from 'react';
import AuthForm from './AuthForm';

function App() {
  const [token, setToken] = useState(null);
  const [showLogin, setShowLogin] = useState(true);

  const handleAuth = (data) => {
    if (data.token) setToken(data.token);
    else setShowLogin(true);
  };

  if (token) {
    return (
      <div>
        <h1>Welcome!</h1>
        <p>You are logged in.</p>
        <button onClick={() => { setToken(null); setShowLogin(true); }}>Logout</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
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

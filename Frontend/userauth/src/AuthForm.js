import React, { useState } from 'react';

function AuthForm({ type, onAuth }) {
  const [usernameOrEmail, setUsernameOrEmail] = useState(''); // login identifier
  const [username, setUsername] = useState(''); // registration username
  const [email, setEmail] = useState(''); // registration email
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (type === 'register') {
      const trimmedEmail = email.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!trimmedEmail) {
        setError('Email is required');
        return;
      }
      if (!emailRegex.test(trimmedEmail)) {
        setError('Invalid email format');
        return;
      }
    }
    try {
      let payload;
      if (type === 'register') {
        payload = { username: username.trim(), email: email.trim(), password };
      } else { // login
        payload = { identifier: usernameOrEmail, password };
      }
      const res = await fetch(`http://localhost:3001/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        if (data && Array.isArray(data.details) && data.details.length) {
          setError(data.details.join('\n'));
        } else if (data && data.error) {
          setError(data.error);
        } else {
          setError('Registration failed');
        }
        return;
      }
      if (data.error) setError(data.error); // fallback
      else onAuth(data);
    } catch (err) {
      setError('Server error');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2 style={{ marginBottom: 16, color: '#6a82fb' }}>{type === 'register' ? 'Register' : 'Login'}</h2>
      {type === 'register' ? (
        <>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </>
      ) : (
        <input
          type="text"
          placeholder="Username or Email"
          value={usernameOrEmail}
          onChange={e => setUsernameOrEmail(e.target.value)}
          required
          autoComplete="username"
        />
      )}
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          type={showPassword ? 'text' : 'password'}
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={{ paddingRight: 70 }}
        />
        <button
          type="button"
          onClick={() => setShowPassword(p => !p)}
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 12, padding: '4px 8px' }}
          className="btn btn-outline btn-sm"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? 'Hide' : 'Show'}
        </button>
      </div>
      <button type="submit" className="btn btn-lg" style={{ width: '80%', marginTop: 12 }}>
        {type === 'register' ? 'Create Account' : 'Login'}
      </button>
      {error && <p style={{ color: 'red', marginTop: 10 }}>{error}</p>}
    </form>
  );
}

export default AuthForm;

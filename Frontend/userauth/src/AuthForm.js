import React, { useState } from 'react';

function AuthForm({ type, onAuth }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch(`http://localhost:3001/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else onAuth(data);
    } catch (err) {
      setError('Server error');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>{type === 'register' ? 'Register' : 'Login'}</h2>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
      />
      <button type="submit">{type === 'register' ? 'Register' : 'Login'}</button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </form>
  );
}

export default AuthForm;

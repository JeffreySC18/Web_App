// Centralized API base URL for frontend
// Production: default to '/api' for Vercel functions/proxy
// Development: default to 'http://localhost:3001'
export const API_BASE =
  (process.env.NODE_ENV === 'production')
    ? (process.env.REACT_APP_API_URL || '/api')
    : (process.env.REACT_APP_API_URL || 'http://localhost:3001');

// Client-side timeout for immediate transcription (ms)
export const TRANSCRIBE_TIMEOUT_MS = (() => {
  const v = Number(process.env.REACT_APP_TRANSCRIBE_TIMEOUT_MS);
  if (Number.isFinite(v) && v > 0 && v < 300000) return v; // cap at 5 minutes
  return 95_000; // default 95s, below common 100s host limits
})();

// If true, skip immediate /transcribe and always use background upload+poll flow
export const BACKGROUND_ONLY = (() => {
  const v = (process.env.REACT_APP_BACKGROUND_ONLY || 'true').toString().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
})();

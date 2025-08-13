// Centralized API base URL for frontend
// Production: default to '/api' for Vercel functions/proxy
// Development: default to 'http://localhost:3001'
export const API_BASE =
  (process.env.NODE_ENV === 'production')
    ? (process.env.REACT_APP_API_URL || '/api')
    : (process.env.REACT_APP_API_URL || 'http://localhost:3001');

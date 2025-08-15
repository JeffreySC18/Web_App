// Deprecated helper: not used by current app. Export no-ops to avoid runtime errors if imported.
module.exports = {
  json: (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); },
  getSupabase: () => { throw new Error('Deprecated: getSupabase not available in this environment'); },
  verifyAuth: () => null,
  parseMultipart: async () => ({ fields: {}, file: null })
};

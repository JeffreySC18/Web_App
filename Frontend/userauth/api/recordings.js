// Deprecated: this serverless API route is unused in the current CRA app.
// Keeping file to avoid deployment surprises; no-op handler.
module.exports = async (_req, res) => {
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Gone', details: 'This endpoint is deprecated. Use the main API service.' }));
};

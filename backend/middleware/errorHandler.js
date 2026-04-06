function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message);

  // Anthropic API errors
  if (err.status === 401) {
    return res.status(401).json({ error: 'Invalid Anthropic API key' });
  }

  // JSON parse errors (Claude returned invalid JSON)
  if (err instanceof SyntaxError) {
    return res.status(422).json({
      error: 'Failed to parse AI response',
      detail: 'Claude returned non-JSON output. Check prompt formatting.'
    });
  }

  // Google Sheets errors
  if (err.message?.includes('PERMISSION_DENIED')) {
    return res.status(403).json({
      error: 'Google Sheets permission denied',
      detail: 'Check service account permissions on the spreadsheet'
    });
  }

  return res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
}

module.exports = { errorHandler };

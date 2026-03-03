/**
 * Centralized error response helper.
 * In production: never leak internal error details to the client.
 * In development: include the error message for debugging.
 */
const isProd = process.env.NODE_ENV === 'production';

/**
 * Send a safe error response.
 * @param {object} res   - Express response object
 * @param {number} status - HTTP status code
 * @param {string} publicMsg - Safe message shown in all environments
 * @param {Error}  err   - The actual error (only shown in development)
 */
const sendError = (res, status, publicMsg, err = null) => {
  const body = { success: false, message: publicMsg };
  if (!isProd && err) {
    body.detail = err.message;
  }
  // Log internally always (server logs, not client-visible)
  if (err) console.error(`[${status}] ${publicMsg}:`, err.message);
  return res.status(status).json(body);
};

module.exports = { sendError };


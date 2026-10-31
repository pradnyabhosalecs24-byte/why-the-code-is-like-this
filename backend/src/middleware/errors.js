/** Structured application error. `expose` controls whether the message is safe to show users. */
export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const notFound = (msg) => new AppError(404, 'NOT_FOUND', msg);
export const serviceUnavailable = (code, msg) => new AppError(503, code, msg);

const SECRET_PATTERNS = [/gh[pousr]_[A-Za-z0-9]{20,}/g, /github_pat_[A-Za-z0-9_]{20,}/g, /sk-[A-Za-z0-9_-]{20,}/g];
const KEY_VALUE = /(password|token|secret|apikey|api_key)=([^\s&"]+)/gi;

/** Remove anything that looks like a credential before logging. */
export function redact(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const re of SECRET_PATTERNS) text = text.replace(re, '[redacted]');
  text = text.replace(KEY_VALUE, (m, k) => `${k}=[redacted]`);
  return text;
}

export const log = {
  info: (msg, meta) => console.log(`[info] ${msg}${meta ? ' ' + redact(meta) : ''}`),
  warn: (msg, meta) => console.warn(`[warn] ${msg}${meta ? ' ' + redact(meta) : ''}`),
  error: (msg, meta) => console.error(`[error] ${msg}${meta ? ' ' + redact(meta) : ''}`),
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
  }
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) log.error(`${req.method} ${req.path} failed`, { code: err.code, message: err.message });
  const safe = err.expose || status < 500;
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: safe ? err.message : 'Unexpected server error. Check the backend logs.',
      ...(err.details && safe ? { details: err.details } : {}),
    },
  });
}

/** Wrap async route handlers so rejections reach the error handler. */
export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

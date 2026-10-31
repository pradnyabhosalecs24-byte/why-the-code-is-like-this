import { AppError } from './errors.js';

/** Small fixed-window rate limiter (per IP, in memory). Enough for a local tool. */
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'local';
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.start + windowMs - now) / 1000));
      return next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please wait a moment.'));
    }
    next();
  };
}

import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { createApiRouter } from './routes/api.js';
import { createDemoRouter } from './routes/demo.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp(options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(cors({ origin: options.corsOrigins || config.corsOrigins }));
  app.use(express.json({ limit: '20kb' }));
  app.use('/api/demo', createDemoRouter());
  app.use('/api', createApiRouter(options));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundRoute } from './middleware/errorHandler.js';
import { router } from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json({ limit: '20kb' }));

  if (!env.isTest) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        console.log(
          JSON.stringify({
            method: req.method,
            route: req.originalUrl.split('?')[0],
            status: res.statusCode,
            ms: Date.now() - start,
          }),
        );
      });
      next();
    });
  }

  app.use('/api', router);
  app.use(notFoundRoute);
  app.use(errorHandler);
  return app;
}

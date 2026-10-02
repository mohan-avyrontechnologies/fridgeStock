import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { RECEIPT_BODY_LIMIT } from './config/ai.js';
import { errorHandler, notFoundRoute } from './middleware/errorHandler.js';
import { router } from './routes/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins }));
  // A receipt photo is far larger than any other request. Only this route may be big; the parser
  // runs first, and the 20 KB one below then leaves a body that is already parsed alone.
  app.use(['/api/parse/receipt', '/api/parse/photo'], express.json({ limit: RECEIPT_BODY_LIMIT }));
  app.use(express.json({ limit: '20kb' }));

  if (!env.isTest) {
    // Only method, route, status and duration: never bodies or headers.
    app.use((req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        console.log(
          JSON.stringify({
            method: req.method,
            route: req.originalUrl.split('?')[0],
            status: res.statusCode,
            ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
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

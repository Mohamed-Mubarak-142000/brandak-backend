import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { join } from 'path';
import { LOCAL_UPLOAD_ROOT } from './uploads/local-storage.provider';

/** Shared by main.ts and the e2e tests so both run the exact same pipeline. */
export function setupApp(app: INestApplication, corsOrigins: string[] = []) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: corsOrigins.length ? corsOrigins : false, credentials: false });
  // Store web pages (/s/:slug) live at the root, for short bio links.
  app.setGlobalPrefix('api/v1', { exclude: ['uploads/public/(.*)', 's/(.*)'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  express.useStaticAssets(join(LOCAL_UPLOAD_ROOT, 'public'), { prefix: '/uploads/public/', index: false });
  return app;
}

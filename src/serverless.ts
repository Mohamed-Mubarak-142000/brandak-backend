import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import { Logger } from 'nestjs-pino';
import { setupApp } from './setup-app';

/**
 * Vercel entry point. The Nest app (and its MongoDB connection) is created once per warm
 * function instance and reused across requests.
 */
let server: Promise<express.Express> | undefined;

async function bootstrap() {
  // Imported lazily: ConfigModule validates the environment at import time, and a failure
  // here must be caught below instead of crashing the whole function.
  const { AppModule } = await import('./app.module');
  const instance = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(instance), {
    bufferLogs: true,
    abortOnError: false, // throw instead of process.exit so the handler can report it
  });
  app.useLogger(app.get(Logger));
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  setupApp(app, origins);
  await app.init();
  return instance;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  server ??= bootstrap().catch((e) => {
    server = undefined; // let the next request retry instead of caching the failure
    throw e;
  });
  let app: express.Express;
  try {
    app = await server;
  } catch (e) {
    // Boot failures (bad env, DB unreachable) end up in Vercel's runtime logs with the real reason.
    console.error('Brandak API failed to start:', e instanceof Error ? e.message : e);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'API failed to start' } }));
    return;
  }
  app(req as express.Request, res as express.Response);
}

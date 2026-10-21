import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { CONTACT_CHANNEL, LogContactChannel } from '@/auth/contact-channel';

// 1x1 transparent PNG — enough to pass the magic-byte check.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface TestContext {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  replSet: MongoMemoryReplSet;
  contact: LogContactChannel;
  close: () => Promise<void>;
}

/** `override` swaps providers (e.g. a fake AI model) before the app compiles. */
export async function createTestApp(override?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<TestContext> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: replSet.getUri('brandak_test'),
    JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-123',
    JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-12',
    STORAGE_DRIVER: 'local',
    PUBLIC_BASE_URL: 'http://localhost',
    INSTAPAY_RECEIVER: '01050867135',
    SUBSCRIPTION_GRACE_DAYS: '0',
    // Never send real email from tests: codes go to the log channel the tests read.
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    // Never call real AI from tests.
    GEMINI_API_KEY: '',
    SEED_ADMIN_EMAIL: 'admin@brandak.test',
    SEED_ADMIN_PASSWORD: 'AdminPass123',
  });
  // Imported after env is set: ConfigModule.forRoot reads the environment at import time.
  const { AppModule } = await import('@/app.module');
  const { setupApp } = await import('@/setup-app');
  const { seed } = await import('@/seed/seed');

  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (override ? override(builder) : builder).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app);
  await app.init();
  // Collections must exist before the first multi-document transaction touches them.
  const { getConnectionToken } = await import('@nestjs/mongoose');
  const connection = app.get(getConnectionToken());
  await Promise.all(Object.values(connection.models).map((m: any) => m.init()));
  await seed(app, () => undefined);

  return {
    app,
    replSet,
    http: () => request(app.getHttpServer()),
    contact: app.get(CONTACT_CHANNEL),
    close: async () => {
      await app.close();
      await replSet.stop();
    },
  };
}

let phoneSeq = 10_000_000;

/** Registers a user with a unique Egyptian number and returns its tokens. */
export async function registerUser(ctx: TestContext, name = 'Test User') {
  phoneSeq += 1;
  const phone = `010${phoneSeq}`;
  const email = `user${phoneSeq}@test.dev`;
  const res = await ctx.http().post('/api/v1/auth/register').send({ name, email, phone, password: 'Passw0rd!' }).expect(201);
  return { token: res.body.data.accessToken as string, refresh: res.body.data.refreshToken as string, id: res.body.data.user.id as string, email, phone };
}

export async function loginAdmin(ctx: TestContext) {
  const res = await ctx
    .http()
    .post('/api/v1/auth/login')
    .send({ identifier: 'admin@brandak.test', password: 'AdminPass123' })
    .expect(200);
  return res.body.data.accessToken as string;
}

export async function upload(ctx: TestContext, token: string, purpose: string) {
  const res = await ctx
    .http()
    .post('/api/v1/uploads')
    .set('Authorization', `Bearer ${token}`)
    .field('purpose', purpose)
    .attach('file', PNG, { filename: 'x.png', contentType: 'image/png' })
    .expect(201);
  return res.body.data.id as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

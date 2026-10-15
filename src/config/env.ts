import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default(''),
  STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  INSTAPAY_RECEIVER: z.string().min(1),
  INSTAPAY_RECEIVER_NAME: z.string().default('Brandak'),
  /** Shared secret Vercel Cron sends to /internal/cron/* endpoints. */
  CRON_SECRET: z.string().min(16).optional(),
  SUBSCRIPTION_GRACE_DAYS: z.coerce.number().int().min(0).default(0),
  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (
    env.STORAGE_DRIVER === 'cloudinary' &&
    (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET)
  ) {
    throw new Error('Cloudinary credentials are required when STORAGE_DRIVER=cloudinary');
  }
  if (env.NODE_ENV === 'production' && env.STORAGE_DRIVER === 'local') {
    throw new Error('STORAGE_DRIVER=local is not allowed in production');
  }
  return env;
}

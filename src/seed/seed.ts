/**
 * Idempotent seed: plans, categories, the first super admin, and data backfills.
 *   npm run seed
 */
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { Model } from 'mongoose';
import { AppModule } from '@/app.module';
import { Role, StoreType } from '@/common/enums';
import { Env } from '@/config/env';
import { Brand } from '@/brands/brand.schema';
import { Category } from '@/categories/category.schema';
import { SubscriptionPlan } from '@/subscriptions/plan.schema';
import { User } from '@/users/user.schema';
import { CATEGORIES, PLANS } from './seed-data';

export async function seed(app: { get: <T>(token: any) => T }, log = console.log) {
  const plans = app.get<Model<SubscriptionPlan>>(getModelToken(SubscriptionPlan.name));
  const categories = app.get<Model<Category>>(getModelToken(Category.name));
  const users = app.get<Model<User>>(getModelToken(User.name));
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  for (const plan of PLANS) {
    // Insert only: never overwrite prices an admin has edited.
    await plans.updateOne({ code: plan.code }, { $setOnInsert: plan }, { upsert: true });
  }
  for (const category of CATEGORIES) {
    await categories.updateOne({ slug: category.slug }, { $setOnInsert: { ...category, parentId: null } }, { upsert: true });
  }
  log(`Seeded ${PLANS.length} plans and ${CATEGORIES.length} categories`);

  // Stores created before storeType existed were all brands.
  const brands = app.get<Model<Brand>>(getModelToken(Brand.name));
  const typed = await brands.updateMany({ storeType: { $exists: false } }, { $set: { storeType: StoreType.BRAND } });
  if (typed.modifiedCount) log(`Set storeType=BRAND on ${typed.modifiedCount} existing stores`);

  const email = config.get('SEED_ADMIN_EMAIL', { infer: true });
  const password = config.get('SEED_ADMIN_PASSWORD', { infer: true });
  if (email && password) {
    const exists = await users.exists({ email });
    if (!exists) {
      await users.create({
        name: 'Brandak Admin',
        email,
        phone: '+201000000000',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        roles: [Role.SUPER_ADMIN, Role.CUSTOMER],
        emailVerifiedAt: new Date(),
      });
      log(`Created super admin ${email} — change the password after first login`);
    }
  }
}

if (require.main === module) {
  (async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    await seed(app);
    await app.close();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

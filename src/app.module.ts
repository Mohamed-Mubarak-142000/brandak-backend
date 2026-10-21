import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AddressesModule } from './addresses/addresses.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { BrandMembersModule } from './brands/brand-members.module';
import { BrandsModule } from './brands/brands.module';
import { CartsModule } from './carts/carts.module';
import { CategoriesModule } from './categories/categories.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { Env, validateEnv } from './config/env';
import { HealthController } from './health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CommissionsModule } from './commissions/commissions.module';
import { PromotionsModule } from './promotions/promotions.module';
import { QuestionsModule } from './questions/questions.module';
import { ReturnsModule } from './returns/returns.module';
import { SupportModule } from './support/support.module';
import { AdsModule } from './ads/ads.module';
import { AiModule } from './ai/ai.module';
import { AlertsModule } from './alerts/alerts.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { ResellersModule } from './resellers/resellers.module';
import { TrackingModule } from './tracking/tracking.module';
import { InsightsModule } from './insights/insights.module';
import { StorefrontModule } from './storefront/storefront.controller';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { WishlistsModule } from './wishlists/wishlists.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        return {
          pinoHttp: {
            level: env === 'test' ? 'silent' : env === 'production' ? 'info' : 'debug',
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : `req_${randomUUID()}`;
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            // pino-pretty is a dev dependency and runs in a worker thread, so never use it on Vercel.
            transport:
              env === 'development' && !process.env.VERCEL
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        };
      },
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGODB_URI', { infer: true }),
        autoIndex: true,
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    // On Vercel there is no long-running process; Vercel Cron calls /internal/cron/* instead.
    ...(process.env.VERCEL ? [] : [ScheduleModule.forRoot()]),
    AuditLogsModule,
    NotificationsModule,
    UploadsModule,
    BrandMembersModule,
    UsersModule,
    AuthModule,
    CategoriesModule,
    BrandsModule,
    SubscriptionsModule,
    CommissionsModule,
    PromotionsModule,
    QuestionsModule,
    ReturnsModule,
    SupportModule,
    AdsModule,
    AiModule,
    AlertsModule,
    LoyaltyModule,
    ResellersModule,
    TrackingModule,
    InsightsModule,
    StorefrontModule,
    ProductsModule,
    AddressesModule,
    WishlistsModule,
    CartsModule,
    OrdersModule,
    ReviewsModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}

import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '@/users/users.module';
import { CronController } from './cron.controller';
import { InstapayManualProvider, SUBSCRIPTION_PAYMENT_PROVIDER } from './payment-provider';
import { Payment, PaymentSchema } from './payment.schema';
import { SubscriptionPlan, SubscriptionPlanSchema } from './plan.schema';
import { SubscriptionJobs } from './subscription-jobs';
import { Subscription, SubscriptionSchema } from './subscription.schema';
import { AdminSubscriptionsController, SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Global()
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: SubscriptionPlan.name, schema: SubscriptionPlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
  ],
  controllers: [SubscriptionsController, AdminSubscriptionsController, CronController],
  providers: [
    SubscriptionsService,
    SubscriptionJobs,
    { provide: SUBSCRIPTION_PAYMENT_PROVIDER, useClass: InstapayManualProvider },
  ],
  exports: [SubscriptionsService, SubscriptionJobs, MongooseModule],
})
export class SubscriptionsModule {}

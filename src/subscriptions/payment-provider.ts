import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@/common/enums';
import { Env } from '@/config/env';

export const SUBSCRIPTION_PAYMENT_PROVIDER = Symbol('SUBSCRIPTION_PAYMENT_PROVIDER');

/**
 * How brand owners pay for subscriptions. The manual InstaPay flow is the only one in the MVP;
 * an app-store billing or gateway provider can replace it without touching subscription logic.
 */
export interface SubscriptionPaymentProvider {
  readonly method: PaymentMethod;
  /** Whether an admin must confirm the money arrived before activation. */
  readonly requiresManualReview: boolean;
  instructions(amount: number): Record<string, unknown>;
}

@Injectable()
export class InstapayManualProvider implements SubscriptionPaymentProvider {
  readonly method = PaymentMethod.INSTAPAY_MANUAL;
  readonly requiresManualReview = true;

  constructor(private readonly config: ConfigService<Env, true>) {}

  instructions(amount: number) {
    return {
      method: this.method,
      amount,
      currency: 'EGP',
      receiver: this.config.get('INSTAPAY_RECEIVER', { infer: true }),
      receiverName: this.config.get('INSTAPAY_RECEIVER_NAME', { infer: true }),
      stepsAr: [
        'افتح تطبيق InstaPay وحوّل المبلغ المطلوب بالضبط إلى الرقم الموضح.',
        'احتفظ بصورة إيصال التحويل والرقم المرجعي للعملية.',
        'ارفع صورة الإيصال واكتب الرقم المرجعي من شاشة الاشتراك.',
        'سيتم تفعيل الاشتراك بعد مراجعة الإدارة والتأكد من وصول التحويل.',
      ],
    };
  }
}

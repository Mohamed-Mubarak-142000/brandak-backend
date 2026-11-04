import { Types } from 'mongoose';
import { Tool } from '@/ai/gemini.client';
import type { AnalyticsService } from '@/analytics/analytics.service';
import { resolveRange } from '@/analytics/analytics.service';
import type { CommissionsService } from '@/commissions/commissions.service';
import { OrderStatus } from '@/common/enums';
import type { InsightsService } from '@/insights/insights.service';
import type { OrdersService } from '@/orders/orders.service';
import type { QuestionsService } from '@/questions/questions.service';

/** Read-only data sources; every call is given the caller's brandId, never one from the model. */
export interface CopilotToolDeps {
  analytics: Pick<AnalyticsService, 'brandOverview'>;
  orders: Pick<OrdersService, 'digestForBrand'>;
  insights: Pick<InsightsService, 'forBrand' | 'missing'>;
  questions: Pick<QuestionsService, 'listForBrand'>;
  commissions: Pick<CommissionsService, 'statusFor'>;
  lowStock: (brandId: string) => Promise<unknown[]>;
  assistantUnanswered: (brandId: string) => Promise<unknown>;
}

const days = (v: unknown) => (Number(v) >= 30 ? 30 : 7);

export function copilotTools(deps: CopilotToolDeps, brandId: string): Tool[] {
  // One overview per period per message, shared by the tools that read it.
  const overviews = new Map<number, ReturnType<AnalyticsService['brandOverview']>>();
  const overview = (d: number) => {
    if (!overviews.has(d)) overviews.set(d, deps.analytics.brandOverview(brandId, resolveRange(new Date(Date.now() - d * 86_400_000).toISOString())));
    return overviews.get(d)!;
  };
  const statuses = Object.values(OrderStatus) as string[];

  return [
    {
      declaration: {
        name: 'get_sales_overview',
        description: 'ملخص المبيعات لآخر 7 أو 30 يوم: عدد الطلبات، قيمة المبيعات، التغيير عن الفترة اللي قبلها، المستلم فعلاً، متوسط الطلب، الطلبات المستنية.',
        parameters: { type: 'OBJECT', properties: { days: { type: 'INTEGER', description: '7 أو 30' } }, required: ['days'] },
      },
      handler: async (args) => {
        const d = days(args.days);
        const o = await overview(d);
        return {
          days: d,
          orders: o.orders.count,
          ordersChangePct: o.orders.changePct,
          pendingNow: o.orders.pendingNow,
          byStatus: o.orders.byStatus,
          salesValue: o.salesValue,
          salesChangePct: o.salesChangePct,
          deliveredRevenue: o.deliveredRevenue,
          averageOrderValue: o.averageOrderValue,
          activeProducts: o.activeProducts,
          daily: o.daily,
        };
      },
    },
    {
      declaration: {
        name: 'get_orders',
        description: 'عدد الطلبات لكل حالة (آخر 30 يوم) وآخر 10 طلبات (ممكن تحدد حالة).',
        parameters: { type: 'OBJECT', properties: { status: { type: 'STRING', enum: statuses } } },
      },
      handler: (args) => deps.orders.digestForBrand(brandId, statuses.includes(args.status as string) ? (args.status as OrderStatus) : undefined),
    },
    {
      declaration: { name: 'get_low_stock', description: 'المنتجات المنشورة اللي فيها اختيار مخزونه 3 أو أقل.' },
      handler: async () => ({ threshold: 3, products: await deps.lowStock(brandId) }),
    },
    {
      declaration: {
        name: 'get_top_products',
        description: 'أكتر 5 منتجات مبيعاً (بالكمية) في آخر 7 أو 30 يوم.',
        parameters: { type: 'OBJECT', properties: { days: { type: 'INTEGER', description: '7 أو 30' } }, required: ['days'] },
      },
      handler: async (args) => {
        const d = days(args.days);
        const o = await overview(d);
        return { days: d, products: o.topProducts.map((p: Record<string, unknown>) => ({ title: p.title, quantity: p.quantity, revenue: p.revenue })) };
      },
    },
    {
      declaration: {
        name: 'get_search_insights',
        description: 'كلمات البحث اللي ظهرت فيها منتجات المتجر (آخر 30 يوم)، والكلمات اللي الناس بتدوّر عليها في فاترينة ومش لاقية نتايج.',
      },
      handler: async () => {
        const [yours, missing] = await Promise.all([deps.insights.forBrand(brandId, 30, 10), deps.insights.missing(30, 10)]);
        return { days: 30, searchesShowingYourProducts: yours, searchedButNotFoundOnFatrina: missing };
      },
    },
    {
      declaration: { name: 'get_unanswered', description: 'أسئلة العملاء على المنتجات اللي لسه ملهاش رد، وأسئلة مساعد المتجر اللي معرفش يجاوبها (آخر 7 أيام).' },
      handler: async () => {
        const [questions, assistant] = await Promise.all([
          deps.questions.listForBrand(brandId, { page: 1, limit: 5, unanswered: true }),
          deps.assistantUnanswered(brandId),
        ]);
        return {
          productQuestions: {
            unansweredCount: questions.total,
            latest: questions.items.map((q) => ({ product: q.productTitle, question: q.text, askedAt: q.createdAt })),
          },
          assistantUnanswered7d: assistant,
        };
      },
    },
    {
      declaration: { name: 'get_commission_status', description: 'عمولة فاترينة: المستحق، آخر ميعاد للسداد، هل الطلبات موقوفة، نسبة العمولة، ودفعة تحت المراجعة.' },
      handler: async () => {
        const s = await deps.commissions.statusFor(new Types.ObjectId(brandId));
        return {
          balance: s.balance,
          dueBy: s.dueBy,
          ordersBlocked: s.blocked,
          commissionRate: s.commissionRate,
          settlementDays: s.settlementDays,
          maxUnpaidBalance: s.maxUnpaidBalance,
          paymentUnderReview: s.pendingSettlement ? { amount: s.pendingSettlement.amount, at: s.pendingSettlement.createdAt } : null,
        };
      },
    },
  ];
}

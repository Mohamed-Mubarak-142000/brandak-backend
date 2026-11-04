import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { cairoDay, refundDaily, takeDaily } from '@/ai/daily-usage';
import { GeminiClient, GeminiError } from '@/ai/gemini.client';
import { AnalyticsService } from '@/analytics/analytics.service';
import { Brand } from '@/brands/brand.schema';
import { CommissionsService } from '@/commissions/commissions.service';
import { ProductStatus, StoreType } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Env } from '@/config/env';
import { InsightsService } from '@/insights/insights.service';
import { OrdersService } from '@/orders/orders.service';
import { Product } from '@/products/product.schema';
import { QuestionsService } from '@/questions/questions.service';
import { UsersService } from '@/users/users.service';
import { copilotPrompt } from './assistant.prompt';
import { CopilotConversation, CopilotUsage } from './assistant.schemas';
import { AssistantService } from './assistant.service';
import { copilotTools } from './copilot.tools';

const HISTORY = 10;
const LOW_STOCK = 3;

/** The store owner's business assistant: reads the store's numbers, writes copy, changes nothing. */
@Injectable()
export class CopilotService {
  private readonly dailyLimit: number;

  constructor(
    @InjectModel(CopilotConversation.name) private readonly conversations: Model<CopilotConversation>,
    @InjectModel(CopilotUsage.name) private readonly usage: Model<CopilotUsage>,
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    private readonly analytics: AnalyticsService,
    private readonly orders: OrdersService,
    private readonly insights: InsightsService,
    private readonly questions: QuestionsService,
    private readonly commissions: CommissionsService,
    private readonly assistant: AssistantService,
    private readonly users: UsersService,
    private readonly gemini: GeminiClient,
    config: ConfigService<Env, true>,
  ) {
    this.dailyLimit = config.get('COPILOT_DAILY_LIMIT', { infer: true });
  }

  async sendMessage(userId: string, brandId: string, dto: { conversationId?: string; text: string }) {
    if (!this.gemini.enabled) throw new AppError('AI_UNAVAILABLE', 'The assistant is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    const text = dto.text.trim();
    if (!text) throw AppError.unprocessable('EMPTY_MESSAGE', 'Write a message');
    const brand = await this.brandModel.findById(brandId).select('name storeType').lean();
    if (!brand) throw AppError.notFound('Brand');
    const owner = { brandId: brand._id, userId: new Types.ObjectId(userId) };
    const conversation =
      dto.conversationId && isValidObjectId(dto.conversationId)
        ? await this.conversations.findOne({ _id: dto.conversationId, ...owner }).select({ messages: { $slice: -HISTORY } }).lean()
        : null;

    const usageKey = { brandId: brand._id, day: cairoDay() };
    if (!(await takeDaily(this.usage, usageKey, this.dailyLimit))) {
      throw new AppError('COPILOT_DAILY_LIMIT', `Up to ${this.dailyLimit} copilot messages per day`, HttpStatus.TOO_MANY_REQUESTS);
    }
    const me = await this.users.getById(userId).catch(() => null);
    let reply: string;
    try {
      const result = await this.gemini.runWithTools({
        system: copilotPrompt({ storeName: brand.name, storeType: brand.storeType ?? StoreType.BRAND, ownerFirstName: me?.name?.split(' ')[0] }),
        history: (conversation?.messages ?? []).map((m) => ({ role: m.role === 'assistant' ? ('model' as const) : ('user' as const), text: m.text })),
        userText: text,
        tools: copilotTools(this.deps(), brandId),
        maxRounds: 4,
        budgetMs: 40_000,
        generationConfig: { temperature: 0.5 },
      });
      reply = result.text.trim().slice(0, 4000) || 'معلش، مقدرتش أجاوب دلوقتي. جرّب تسأل تاني بشكل مختلف.';
    } catch (e) {
      await refundDaily(this.usage, usageKey);
      if (e instanceof GeminiError) {
        if (e.reason === 'BUSY') throw new AppError('AI_BUSY', 'The assistant is busy, try again in a minute', HttpStatus.SERVICE_UNAVAILABLE);
        throw new AppError('AI_UNAVAILABLE', 'The assistant is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw e;
    }

    const now = new Date();
    const messages = [
      { role: 'user' as const, text, at: now },
      { role: 'assistant' as const, text: reply, at: new Date(now.getTime() + 1) },
    ];
    let conversationId: string;
    if (conversation) {
      await this.conversations.updateOne({ _id: conversation._id }, { $push: { messages: { $each: messages, $slice: -200 } }, $set: { lastAt: now } });
      conversationId = conversation._id.toString();
    } else {
      conversationId = (await this.conversations.create({ ...owner, messages, lastAt: now }))._id.toString();
    }
    return { conversationId, reply: { text: reply } };
  }

  async getConversation(userId: string, brandId: string, id: string) {
    const c = await this.conversations.findOne({ _id: id, brandId: new Types.ObjectId(brandId), userId: new Types.ObjectId(userId) }).lean();
    if (!c) throw AppError.notFound('Conversation');
    return { id: c._id.toString(), lastAt: c.lastAt, messages: c.messages.map((m) => ({ role: m.role, text: m.text, at: m.at })) };
  }

  /** Exposed for tests: the data sources the copilot's tools read. */
  deps() {
    return {
      analytics: this.analytics,
      orders: this.orders,
      insights: this.insights,
      questions: this.questions,
      commissions: this.commissions,
      lowStock: async (brandId: string) => {
        const rows = await this.productModel
          .find({ brandId: new Types.ObjectId(brandId), status: ProductStatus.ACTIVE, 'variants.stock': { $lte: LOW_STOCK } })
          .select('title variants')
          .limit(15)
          .lean();
        return rows.map((p) => ({
          title: p.title,
          variants: p.variants.filter((v) => v.stock <= LOW_STOCK).map((v) => ({ size: v.size ?? null, color: v.color ?? null, stock: v.stock })),
        }));
      },
      assistantUnanswered: (brandId: string) => this.assistant.recentUnanswered(brandId),
    };
  }
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import { cairoDay, refundDaily, takeDaily, usedToday } from '@/ai/daily-usage';
import { GeminiClient, GeminiError } from '@/ai/gemini.client';
import { assistantSettingsOf, Brand } from '@/brands/brand.schema';
import { BrandsService } from '@/brands/brands.service';
import { AuthUser } from '@/common/decorators';
import { ProductStatus, StoreType } from '@/common/enums';
import { AppError } from '@/common/errors';
import { Lean, PageResult } from '@/common/pagination';
import { Env } from '@/config/env';
import { OrdersService } from '@/orders/orders.service';
import { Product } from '@/products/product.schema';
import { ProductsService } from '@/products/products.service';
import { UsersService } from '@/users/users.service';
import { assistantPrompt, displayName, greeting, SUGGESTIONS } from './assistant.prompt';
import { AssistantConversation, AssistantUsage, AssistantVisitorUsage } from './assistant.schemas';
import { AssistantAction, AssistantStore, assistantTools, AssistantTurnState, ProductCard } from './assistant.tools';
import { AssistantMessageDto, AssistantSettingsPatchDto, ConversationsQueryDto } from './assistant.dto';

const VISITOR_DAILY_LIMIT = 40;
const HISTORY = 10;
const KEEP_MESSAGES = 200;
const UNSURE = 'محتاج أتأكد من المتجر في النقطة دي.';
const DAY_MS = 86_400_000;

export interface AssistantReply {
  conversationId: string;
  reply: { text: string; products: ProductCard[]; actions: AssistantAction[]; unanswered: boolean };
}

const firstName = (name?: string | null) => (name ?? '').trim().split(/\s+/)[0] || null;
/** Replies are plain text: drop heavy Markdown the model sometimes adds. */
const tidy = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    // The lite model sometimes writes a tool call as text ("suggest_action(action="login")").
    .replace(/^\s*`?(?:suggest_action|show_products|cannot_answer|search_products|get_product|get_store_info|get_my_orders)\s*\(.*\)`?\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1500);

/** A store's assistant: answers visitors on the store page from that store's own data only. */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly dailyLimit: number;

  constructor(
    @InjectModel(AssistantConversation.name) private readonly conversations: Model<AssistantConversation>,
    @InjectModel(AssistantUsage.name) private readonly usage: Model<AssistantUsage>,
    @InjectModel(AssistantVisitorUsage.name) private readonly visitorUsage: Model<AssistantVisitorUsage>,
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
    private readonly brands: BrandsService,
    private readonly products: ProductsService,
    private readonly orders: OrdersService,
    private readonly users: UsersService,
    private readonly gemini: GeminiClient,
    config: ConfigService<Env, true>,
  ) {
    this.dailyLimit = config.get('ASSISTANT_DAILY_LIMIT', { infer: true });
  }

  // ---------- Public ----------

  private async visibleBrand(slug: string) {
    return this.brandModel
      .findOne({ slug, ...this.brands.visibleFilter() })
      .select('name slug storeType contact settings')
      .lean<Lean<Brand>>();
  }

  async publicInfo(slug: string) {
    const brand = await this.visibleBrand(slug);
    const a = assistantSettingsOf(brand?.settings);
    if (!brand || !a.enabled || !this.gemini.enabled) return { enabled: false, name: '', greeting: '', suggestions: [] as string[] };
    return {
      enabled: true,
      name: displayName(a.name, brand.name),
      greeting: greeting(a.name, brand.name),
      suggestions: SUGGESTIONS[brand.storeType ?? StoreType.BRAND],
    };
  }

  async sendMessage(slug: string, dto: AssistantMessageDto, user?: AuthUser): Promise<AssistantReply> {
    const brand = await this.visibleBrand(slug);
    const a = assistantSettingsOf(brand?.settings);
    if (!brand || !a.enabled) throw new AppError('ASSISTANT_DISABLED', 'This store has no assistant', HttpStatus.NOT_FOUND);
    if (!this.gemini.enabled) throw new AppError('AI_UNAVAILABLE', 'The assistant is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    const text = dto.text.trim();
    if (!text) throw AppError.unprocessable('EMPTY_MESSAGE', 'Write a message');

    // Only a conversation of this store and this visitor (or this signed-in user) continues.
    const owner: FilterQuery<AssistantConversation>[] = [{ visitorId: dto.visitorId }];
    if (user) owner.push({ userId: new Types.ObjectId(user.userId) });
    const conversation =
      dto.conversationId && isValidObjectId(dto.conversationId)
        ? await this.conversations
            .findOne({ _id: dto.conversationId, brandId: brand._id, $or: owner })
            .select({ messages: { $slice: -HISTORY }, productId: 1, userId: 1 })
            .lean()
        : null;

    // Quotas: the store's daily replies, then this visitor's (across all stores).
    const day = cairoDay();
    const brandKey = { brandId: brand._id, day };
    const visitorKey = { key: user ? `u:${user.userId}` : `v:${dto.visitorId}`, day };
    if (!(await takeDaily(this.usage, brandKey, this.dailyLimit))) {
      throw new AppError('ASSISTANT_DAILY_LIMIT', 'The store assistant has answered its maximum for today', HttpStatus.TOO_MANY_REQUESTS, [
        { reason: 'store' },
      ]);
    }
    if (!(await takeDaily(this.visitorUsage, visitorKey, VISITOR_DAILY_LIMIT))) {
      await refundDaily(this.usage, brandKey);
      throw new AppError('ASSISTANT_DAILY_LIMIT', `Up to ${VISITOR_DAILY_LIMIT} assistant messages per day`, HttpStatus.TOO_MANY_REQUESTS, [
        { reason: 'visitor' },
      ]);
    }
    const refund = () => Promise.all([refundDaily(this.usage, brandKey), refundDaily(this.visitorUsage, visitorKey)]);

    let reply: { text: string; state: AssistantTurnState; productId: Types.ObjectId | null };
    try {
      reply = await this.answer(brand, a, text, conversation, dto.productId, user);
    } catch (e) {
      await refund();
      if (e instanceof GeminiError) {
        if (e.reason === 'BUSY') throw new AppError('AI_BUSY', 'The assistant is busy, try again in a minute', HttpStatus.SERVICE_UNAVAILABLE);
        throw new AppError('AI_UNAVAILABLE', 'The assistant is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw e;
    }

    const now = new Date();
    const { state } = reply;
    const messages = [
      { role: 'user' as const, text, productIds: [], unanswered: false, at: now },
      {
        role: 'assistant' as const,
        text: reply.text,
        productIds: state.shown.map((c) => new Types.ObjectId(c.id)),
        unanswered: state.unanswered,
        at: new Date(now.getTime() + 1),
      },
    ];
    let conversationId: string;
    if (conversation) {
      await this.conversations.updateOne(
        { _id: conversation._id },
        {
          $push: { messages: { $each: messages, $slice: -KEEP_MESSAGES } },
          $set: { lastAt: now, ...(user && !conversation.userId ? { userId: new Types.ObjectId(user.userId) } : {}) },
          $inc: { count: 2 },
        },
      );
      conversationId = conversation._id.toString();
    } else {
      const created = await this.conversations.create({
        brandId: brand._id,
        visitorId: dto.visitorId,
        userId: user ? new Types.ObjectId(user.userId) : undefined,
        productId: reply.productId ?? undefined,
        messages,
        lastAt: now,
        count: 2,
      });
      conversationId = created._id.toString();
    }
    return {
      conversationId,
      reply: { text: reply.text, products: state.shown, actions: [...state.actions], unanswered: state.unanswered },
    };
  }

  private async answer(
    brand: Lean<Brand>,
    a: ReturnType<typeof assistantSettingsOf>,
    text: string,
    conversation: { messages?: AssistantConversation['messages']; productId?: Types.ObjectId } | null,
    productIdInput: string | undefined,
    user: AuthUser | undefined,
  ) {
    const brandId = brand._id.toString();
    // The product page the chat is about: this message's, else the one the chat started on.
    const productId = productIdInput ?? conversation?.productId?.toString();
    const product =
      productId && isValidObjectId(productId)
        ? await this.productModel.findOne({ _id: productId, brandId: brand._id, status: ProductStatus.ACTIVE }).select('title').lean()
        : null;
    const customer = user ? await this.users.getById(user.userId).catch(() => null) : null;

    const store: AssistantStore = {
      id: brandId,
      name: brand.name,
      whatsapp: !!brand.contact?.whatsapp,
      settings: brand.settings ?? {},
      extraInfo: a.extraInfo,
    };
    const state: AssistantTurnState = { shown: [], actions: new Set(), unanswered: false };
    const tools = assistantTools(
      { products: this.products, orders: this.orders, activeCards: (id, ids) => this.activeCards(id, ids) },
      store,
      user,
      state,
    );
    const system = assistantPrompt({
      storeName: brand.name,
      storeType: brand.storeType ?? StoreType.BRAND,
      assistantName: a.name,
      tone: a.tone,
      signedIn: !!user,
      customerFirstName: firstName(customer?.name),
      product: product ? { id: product._id.toString(), title: product.title } : null,
    });
    const history = (conversation?.messages ?? []).map((m) => ({ role: m.role === 'assistant' ? ('model' as const) : ('user' as const), text: m.text }));
    const result = await this.gemini.runWithTools({ system, history, userText: text, tools, maxRounds: 4, budgetMs: 40_000, generationConfig: { temperature: 0.4 } });
    this.logger.log(
      `assistant ${brand.slug}: ${result.model}, ${result.rounds} rounds, tools ${result.calls.map((c) => c.name).join(',') || '-'}` +
        ` | ${(result.trace ?? []).map((t) => `${t.round}:${t.model}:${t.ms}ms:${t.calls.join('+') || 'text'}`).join(' ')}`,
    );

    let reply = tidy(result.text);
    if (!reply) reply = UNSURE;
    // Saying it must check with the store counts as unanswered even if the model skipped cannot_answer.
    if (reply.includes('محتاج أتأكد')) {
      state.unanswered = true;
      if (store.whatsapp) state.actions.add('whatsapp');
    }
    // Asking about their orders while signed out: offer the sign-in button even if the model forgot.
    if (!user && /طلب(ي|اتي)|أوردر|اوردر/.test(text)) state.actions.add('login');
    return { text: reply, state, productId: product?._id ?? null };
  }

  /** Active products of this store among `ids`, as public cards in the given order. */
  async activeCards(brandId: string, ids: string[]): Promise<ProductCard[]> {
    const docs = await this.productModel
      .find({ _id: { $in: ids.filter((id) => isValidObjectId(id)) }, brandId: new Types.ObjectId(brandId), status: ProductStatus.ACTIVE })
      .populate('brandId')
      .lean<Lean<Product>[]>();
    const byId = new Map(docs.map((d) => [d._id.toString(), this.products.toCard(d)]));
    return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
  }

  // ---------- Owner / admin ----------

  async getSettings(brandId: string) {
    const brand = await this.brandModel.findById(brandId).select('name settings').lean();
    if (!brand) throw AppError.notFound('Brand');
    const a = assistantSettingsOf(brand.settings);
    return { ...a, displayName: displayName(a.name, brand.name), available: this.gemini.enabled };
  }

  async updateSettings(brandId: string, dto: AssistantSettingsPatchDto) {
    const set: Record<string, unknown> = {};
    if (dto.enabled !== undefined) set['settings.assistant.enabled'] = dto.enabled;
    if (dto.name !== undefined) set['settings.assistant.name'] = dto.name.trim();
    if (dto.tone !== undefined) set['settings.assistant.tone'] = dto.tone;
    if (dto.extraInfo !== undefined) set['settings.assistant.extraInfo'] = dto.extraInfo.trim();
    // Stores saved before the assistant existed have no block yet: start it from the defaults.
    const current = await this.brandModel.findById(brandId).select('settings').lean();
    if (!current) throw AppError.notFound('Brand');
    if (!current.settings?.assistant) {
      const a = assistantSettingsOf(current.settings);
      await this.brandModel.updateOne({ _id: brandId }, { $set: { 'settings.assistant': { ...a, ...this.unprefix(set) } } });
    } else if (Object.keys(set).length) {
      await this.brandModel.updateOne({ _id: brandId }, { $set: set });
    }
    return this.getSettings(brandId);
  }

  private unprefix(set: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(set).map(([k, v]) => [k.replace('settings.assistant.', ''), v]));
  }

  async listConversations(brandId: string | undefined, query: ConversationsQueryDto, withBrand = false) {
    const filter: FilterQuery<AssistantConversation> = {};
    if (brandId) filter.brandId = new Types.ObjectId(brandId);
    if (query.unanswered) filter['messages.unanswered'] = true;
    const [rows, total] = await Promise.all([
      this.conversations
        .find(filter)
        .sort({ lastAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .select({ messages: { $slice: -1 }, brandId: 1, userId: 1, productId: 1, lastAt: 1, count: 1, ownerSeenAt: 1, createdAt: 1 })
        .populate([
          { path: 'userId', select: 'name' },
          ...(withBrand ? [{ path: 'brandId', select: 'name slug' }] : []),
        ])
        .lean(),
      this.conversations.countDocuments(filter),
    ]);
    const unanswered = new Set(
      (await this.conversations.find({ _id: { $in: rows.map((r) => r._id) }, 'messages.unanswered': true }).select('_id').lean()).map((r) =>
        r._id.toString(),
      ),
    );
    const items = rows.map((c) => {
      const last = c.messages?.[0];
      const u = c.userId as unknown as { name?: string } | undefined;
      const b = c.brandId as unknown as { _id: Types.ObjectId; name?: string; slug?: string };
      return {
        id: c._id.toString(),
        ...(withBrand ? { brand: { id: b?._id?.toString() ?? String(c.brandId), name: b?.name ?? '', slug: b?.slug ?? '' } } : {}),
        lastAt: c.lastAt,
        createdAt: c.createdAt,
        count: c.count,
        lastMessage: last ? { role: last.role, text: last.text.slice(0, 140), at: last.at } : null,
        hasUnanswered: unanswered.has(c._id.toString()),
        signedIn: !!c.userId,
        customerFirstName: firstName(u?.name),
        productId: c.productId?.toString() ?? null,
        seen: !!c.ownerSeenAt && c.ownerSeenAt >= c.lastAt,
      };
    });
    return new PageResult(items, query.page, query.limit, total);
  }

  async getConversation(brandId: string | undefined, id: string, markSeen: boolean) {
    const filter: FilterQuery<AssistantConversation> = { _id: id };
    if (brandId) filter.brandId = new Types.ObjectId(brandId);
    const c = await this.conversations
      .findOne(filter)
      .populate([{ path: 'userId', select: 'name' }, { path: 'brandId', select: 'name slug' }])
      .lean();
    if (!c) throw AppError.notFound('Conversation');
    if (markSeen) await this.conversations.updateOne({ _id: c._id }, { $set: { ownerSeenAt: new Date() } });
    const productIds = [...new Set(c.messages.flatMap((m) => m.productIds.map(String)).concat(c.productId ? [c.productId.toString()] : []))];
    const products = productIds.length
      ? await this.productModel.find({ _id: { $in: productIds } }).select('title images price').lean()
      : [];
    const mini = new Map(products.map((p) => [p._id.toString(), { id: p._id.toString(), title: p.title, imageUrl: p.images[0]?.url ?? null }]));
    const u = c.userId as unknown as { name?: string } | undefined;
    const b = c.brandId as unknown as { _id: Types.ObjectId; name?: string; slug?: string };
    return {
      id: c._id.toString(),
      brand: { id: b?._id?.toString() ?? '', name: b?.name ?? '', slug: b?.slug ?? '' },
      signedIn: !!c.userId,
      customerFirstName: firstName(u?.name),
      product: c.productId ? (mini.get(c.productId.toString()) ?? null) : null,
      lastAt: c.lastAt,
      createdAt: c.createdAt,
      count: c.count,
      messages: c.messages.map((m) => ({
        role: m.role,
        text: m.text,
        at: m.at,
        unanswered: m.unanswered,
        products: m.productIds.map((p) => mini.get(p.toString())).filter(Boolean),
      })),
    };
  }

  async stats(brandId: string) {
    const id = new Types.ObjectId(brandId);
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [used, conversations7d, unanswered] = await Promise.all([
      usedToday(this.usage, { brandId: id, day: cairoDay() }),
      this.conversations.countDocuments({ brandId: id, lastAt: { $gte: since } }),
      this.conversations.aggregate<{ n: number }>([
        { $match: { brandId: id, lastAt: { $gte: since }, 'messages.unanswered': true } },
        { $unwind: '$messages' },
        { $match: { 'messages.unanswered': true, 'messages.at': { $gte: since } } },
        { $count: 'n' },
      ]),
    ]);
    return { today: { used, limit: this.dailyLimit }, conversations7d, unanswered7d: unanswered[0]?.n ?? 0 };
  }

  /** For the seller copilot: recent questions the assistant couldn't answer. */
  async recentUnanswered(brandId: string, days = 7, limit = 5) {
    const id = new Types.ObjectId(brandId);
    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await this.conversations
      .find({ brandId: id, lastAt: { $gte: since }, 'messages.unanswered': true })
      .sort({ lastAt: -1 })
      .limit(20)
      .select('messages')
      .lean();
    const questions: { question: string; at: Date }[] = [];
    for (const c of rows) {
      c.messages.forEach((m, i) => {
        if (m.unanswered && m.at >= since && c.messages[i - 1]?.role === 'user') questions.push({ question: c.messages[i - 1].text, at: m.at });
      });
    }
    questions.sort((x, y) => y.at.getTime() - x.at.getTime());
    return { count: questions.length, latest: questions.slice(0, limit) };
  }

  async requireBrand(id: string) {
    if (!(await this.brandModel.exists({ _id: id }))) throw AppError.notFound('Brand');
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { Brand } from '@/brands/brand.schema';

export const TRACKING_HTTP = Symbol('TRACKING_HTTP');
/** Swappable in tests; defaults to global fetch. */
export type TrackingHttp = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export type TrackedEvent = 'ViewContent' | 'AddToCart' | 'Purchase';

export interface EventInput {
  value?: number;
  contents: { id: string; quantity: number; price: number }[];
  user?: { id?: string; email?: string; phone?: string } | null;
  ip?: string;
  userAgent?: string;
  /** Lets the ad platforms de-duplicate if the same event is also sent from a browser pixel. */
  eventId?: string;
  url?: string;
}

const sha = (v?: string) => (v ? createHash('sha256').update(v.trim().toLowerCase()).digest('hex') : undefined);
const TIKTOK_NAMES: Record<TrackedEvent, string> = { ViewContent: 'ViewContent', AddToCart: 'AddToCart', Purchase: 'PlaceAnOrder' };

/**
 * Sends a store's product views, add-to-carts and orders to its own Facebook (Conversions API)
 * and TikTok (Events API) pixels, so its ads learn who buys. The store pastes its pixel ids and
 * access tokens in its settings; nothing is sent for stores that didn't.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly cache = new Map<string, { at: number; t: Brand['tracking'] | null }>();

  constructor(
    @InjectModel(Brand.name) private readonly brands: Model<Brand>,
    @Inject(TRACKING_HTTP) private readonly http: TrackingHttp,
  ) {}

  /** Owner-facing view: ids shown, tokens never sent back (only whether one is saved). */
  view(t?: Brand['tracking'] | null) {
    return {
      metaPixelId: t?.metaPixelId ?? '',
      hasMetaToken: !!t?.metaAccessToken,
      tiktokPixelId: t?.tiktokPixelId ?? '',
      hasTiktokToken: !!t?.tiktokAccessToken,
    };
  }

  async forBrand(brandId: string) {
    return this.view((await this.brands.findById(brandId).select('tracking').lean())?.tracking);
  }

  async update(brandId: string, dto: { metaPixelId?: string; metaAccessToken?: string; tiktokPixelId?: string; tiktokAccessToken?: string }) {
    // The field starts as null, so merge and write the whole object.
    const current = (await this.brands.findById(brandId).select('tracking').lean())?.tracking ?? {};
    const next: Record<string, string> = { ...current };
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) next[k] = v.trim();
    const brand = await this.brands.findByIdAndUpdate(brandId, { $set: { tracking: next } }, { new: true }).select('tracking').lean();
    this.cache.delete(brandId);
    return this.view(brand?.tracking);
  }

  /** Public pixel ids for the store's web page (browser pixels). */
  async publicIds(brandId: Types.ObjectId | string) {
    const t = await this.config(String(brandId));
    return { metaPixelId: t?.metaPixelId || null, tiktokPixelId: t?.tiktokPixelId || null };
  }

  /** Fire-and-wait (bounded): never throws, never takes more than ~3 seconds. */
  async event(brandId: Types.ObjectId | string, name: TrackedEvent, e: EventInput) {
    try {
      const t = await this.config(String(brandId));
      if (!t) return 0;
      const eventId = e.eventId ?? randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const value = e.value ?? e.contents.reduce((s, c) => s + c.price * c.quantity, 0);
      const phone = e.user?.phone?.replace(/\D/g, '');
      const calls: Promise<unknown>[] = [];
      if (t.metaPixelId && t.metaAccessToken) {
        calls.push(
          this.post(`https://graph.facebook.com/v21.0/${encodeURIComponent(t.metaPixelId)}/events?access_token=${encodeURIComponent(t.metaAccessToken)}`, {}, {
            data: [
              {
                event_name: name,
                event_time: now,
                event_id: eventId,
                action_source: e.url ? 'website' : 'other',
                event_source_url: e.url,
                user_data: {
                  em: e.user?.email ? [sha(e.user.email)] : undefined,
                  ph: phone ? [sha(phone)] : undefined,
                  external_id: e.user?.id ? [sha(e.user.id)] : undefined,
                  client_ip_address: e.ip,
                  client_user_agent: e.userAgent,
                },
                custom_data: { currency: 'EGP', value, content_type: 'product', content_ids: e.contents.map((c) => c.id), num_items: e.contents.reduce((n, c) => n + c.quantity, 0) },
              },
            ],
          }),
        );
      }
      if (t.tiktokPixelId && t.tiktokAccessToken) {
        calls.push(
          this.post('https://business-api.tiktok.com/open_api/v1.3/event/track/', { 'Access-Token': t.tiktokAccessToken }, {
            event_source: 'web',
            event_source_id: t.tiktokPixelId,
            data: [
              {
                event: TIKTOK_NAMES[name],
                event_time: now,
                event_id: eventId,
                user: { email: sha(e.user?.email), phone: sha(phone), external_id: sha(e.user?.id), ip: e.ip, user_agent: e.userAgent },
                properties: { currency: 'EGP', value, content_type: 'product', contents: e.contents.map((c) => ({ content_id: c.id, quantity: c.quantity, price: c.price })) },
                page: e.url ? { url: e.url } : undefined,
              },
            ],
          }),
        );
      }
      const results = await Promise.allSettled(calls);
      return results.filter((r) => r.status === 'fulfilled').length;
    } catch (err) {
      this.logger.warn(`tracking ${name} failed: ${(err as Error).message}`);
      return 0;
    }
  }

  private async post(url: string, headers: Record<string, string>, body: unknown) {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
    const res = await Promise.race([this.http(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), timeout]);
    if (!res.ok) this.logger.warn(`pixel ${new URL(url).host} answered ${res.status}`);
    return res;
  }

  private async config(brandId: string) {
    const hit = this.cache.get(brandId);
    if (hit && Date.now() - hit.at < 60_000) return hit.t;
    const brand = await this.brands.findById(brandId).select('tracking').lean();
    const t = brand?.tracking && (brand.tracking.metaPixelId || brand.tracking.tiktokPixelId) ? brand.tracking : null;
    this.cache.set(brandId, { at: Date.now(), t });
    return t;
  }
}

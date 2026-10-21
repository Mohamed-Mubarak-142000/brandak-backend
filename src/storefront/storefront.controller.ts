import { Controller, Get, Module, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { BrandsService } from '@/brands/brands.service';
import { Public } from '@/common/decorators';
import { ProductsQueryDto } from '@/products/products.dto';
import { ProductsService } from '@/products/products.service';
import { TrackingService } from '@/tracking/tracking.service';

type PublicBrand = Awaited<ReturnType<BrandsService['getPublicBySlug']>>;
type Card = ReturnType<ProductsService['toCard']>;

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (n: number) => `${new Intl.NumberFormat('ar-EG').format(n)} ج.م`;

/**
 * A store's public web page, for the link in its Instagram/TikTok bio: products, prices, and
 * "order on WhatsApp" or "open in the app". Plain server-rendered HTML, cached at the edge.
 */
@ApiExcludeController()
@Controller('s')
export class StorefrontController {
  constructor(
    private readonly brands: BrandsService,
    private readonly products: ProductsService,
    private readonly tracking: TrackingService,
  ) {}

  @Public()
  @Get(':slug')
  async store(@Param('slug') slug: string, @Res() res: Response) {
    const brand = await this.brands.getPublicBySlug(slug).catch(() => null);
    if (!brand) return this.notFound(res);
    const query: ProductsQueryDto = Object.assign(new ProductsQueryDto(), { brandId: brand.id, page: 1, limit: 60, sort: 'newest' });
    const page = await this.products.search(query);
    const ids = await this.tracking.publicIds(brand.id);
    const body = `
      <header class="hero">
        ${brand.coverUrl ? `<img class="cover" src="${esc(brand.coverUrl)}" alt="">` : ''}
        <div class="who">
          ${brand.logoUrl ? `<img class="logo" src="${esc(brand.logoUrl)}" alt="">` : ''}
          <h1>${esc(brand.name)}</h1>
          ${brand.description ? `<p class="muted">${esc(brand.description)}</p>` : ''}
          ${brand.ratingCount ? `<p class="muted">★ ${(brand.ratingAvg ?? 0).toFixed(1)} (${brand.ratingCount} تقييم)</p>` : ''}
        </div>
        <div class="actions">
          <a class="btn" href="fatrina://brand/${esc(brand.slug)}">افتح المتجر في تطبيق فاترينة</a>
          ${this.whatsapp(brand) ? `<a class="btn soft" href="${this.whatsapp(brand, `أهلاً ${brand.name}، عايز أطلب`)}">اطلب على واتساب</a>` : ''}
        </div>
      </header>
      <main class="grid">
        ${page.items.map((p) => this.card(brand, p)).join('') || '<p class="muted center">لسه مفيش منتجات.</p>'}
      </main>`;
    return this.send(res, { title: `${brand.name} على فاترينة`, description: brand.description || `تسوّق من ${brand.name} وادفع عند الاستلام`, image: brand.logoUrl, body, ids });
  }

  @Public()
  @Get(':slug/p/:id')
  async product(@Param('slug') slug: string, @Param('id') id: string, @Res() res: Response) {
    const brand = await this.brands.getPublicBySlug(slug).catch(() => null);
    const p = brand && /^[a-f0-9]{24}$/i.test(id) ? await this.products.getPublic(id).catch(() => null) : null;
    if (!brand || !p || p.brand.id !== brand.id) return this.notFound(res);
    const ids = await this.tracking.publicIds(brand.id);
    const sizes = [...new Set(p.variants.filter((v) => v.inStock).map((v) => [v.size, v.color].filter(Boolean).join(' · ')).filter(Boolean))];
    const body = `
      <a class="back" href="/s/${esc(brand.slug)}">← ${esc(brand.name)}</a>
      <article class="product">
        <div class="photos">${p.images.slice(0, 6).map((u) => `<img src="${esc(u)}" alt="${esc(p.title)}" loading="lazy">`).join('')}</div>
        <h1>${esc(p.title)}</h1>
        <p class="price">${money(p.price)} ${p.compareAtPrice ? `<s class="muted">${money(p.compareAtPrice)}</s>` : ''}</p>
        ${p.inStock ? '' : '<p class="tag">نفدت الكمية</p>'}
        ${sizes.length ? `<p class="muted">المتاح: ${sizes.map(esc).join('، ')}</p>` : ''}
        ${p.description ? `<p>${esc(p.description).replace(/\n/g, '<br>')}</p>` : ''}
        <div class="actions">
          <a class="btn" href="fatrina://product/${esc(p.id)}">اطلب من تطبيق فاترينة</a>
          ${this.whatsapp(brand) ? `<a class="btn soft" href="${this.whatsapp(brand, `عايز أطلب: ${p.title} (${money(p.price)})`)}">اطلب على واتساب</a>` : ''}
        </div>
        <p class="muted small">الدفع عند الاستلام · حماية فاترينة لو الطلب موصلش أو طلع مختلف</p>
      </article>`;
    return this.send(res, {
      title: `${p.title} | ${brand.name}`,
      description: p.description?.slice(0, 160) || `${p.title} بـ ${money(p.price)} من ${brand.name}`,
      image: p.images[0] ?? p.imageUrl,
      body,
      ids,
      viewContent: { id: p.id, price: p.price },
    });
  }

  private card(brand: PublicBrand, p: Card) {
    return `<a class="card" href="/s/${esc(brand.slug)}/p/${esc(p.id)}">
      <span class="img">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">` : ''}${p.inStock ? '' : '<span class="tag">نفدت</span>'}</span>
      <span class="t">${esc(p.title)}</span>
      <span class="price">${money(p.price)} ${p.compareAtPrice ? `<s class="muted">${money(p.compareAtPrice)}</s>` : ''}</span>
    </a>`;
  }

  private whatsapp(brand: PublicBrand, text?: string) {
    const raw = brand.contact?.whatsapp || brand.contact?.phone;
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '').replace(/^0/, '20');
    return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  }

  private send(
    res: Response,
    page: { title: string; description: string; image?: string | null; body: string; ids: { metaPixelId: string | null; tiktokPixelId: string | null }; viewContent?: { id: string; price: number } },
  ) {
    const { metaPixelId: fb, tiktokPixelId: tt } = page.ids;
    const vc = page.viewContent;
    const pixels = [
      fb
        ? `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${esc(fb)}');fbq('track','PageView');${vc ? `fbq('track','ViewContent',{content_ids:['${esc(vc.id)}'],content_type:'product',value:${vc.price},currency:'EGP'});` : ''}</script>`
        : '',
      tt
        ? `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var s=d.createElement("script");s.async=!0;s.src="https://analytics.tiktok.com/i18n/pixel/events.js?sdkid="+e;var f=d.getElementsByTagName("script")[0];f.parentNode.insertBefore(s,f)};ttq.load('${esc(tt)}');ttq.page();${vc ? `ttq.track('ViewContent',{content_id:'${esc(vc.id)}',content_type:'product',value:${vc.price},currency:'EGP'});` : ''}}(window,document,'ttq');</script>`
        : '',
    ].join('');
    const html = `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}">
<meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(page.description)}">
${page.image ? `<meta property="og:image" content="${esc(page.image)}">` : ''}
<meta name="theme-color" content="#E8590C">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#FFFBF7;--surface:#fff;--ink:#2A1D14;--ink2:#6B5A4E;--line:#F0E4D8;--accent:#E8590C;--soft:#FFEADB}
@media (prefers-color-scheme:dark){:root{--bg:#1A130E;--surface:#241A13;--ink:#F7EEE6;--ink2:#C2B2A5;--line:#3A2C22;--accent:#FF7A33;--soft:#3D2416}}
*{box-sizing:border-box}body{margin:0;font-family:Cairo,system-ui,sans-serif;background:var(--bg);color:var(--ink);line-height:1.6}
a{color:inherit;text-decoration:none}.muted{color:var(--ink2)}.small{font-size:13px}.center{text-align:center;grid-column:1/-1}
.hero{max-width:960px;margin:0 auto}.cover{width:100%;max-height:220px;object-fit:cover;display:block}
.who{padding:16px;text-align:center}.logo{width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid var(--surface);margin-top:-48px;background:var(--surface)}
h1{font-size:24px;margin:8px 0 4px}.actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;padding:0 16px 16px}
.btn{background:var(--accent);color:#fff;padding:12px 18px;border-radius:12px;font-weight:700;min-height:44px;display:inline-flex;align-items:center}
.btn.soft{background:var(--soft);color:var(--accent)}
.grid{max-width:960px;margin:0 auto;padding:0 16px 32px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.card{display:flex;flex-direction:column;gap:4px}.img{position:relative;aspect-ratio:4/5;border-radius:14px;overflow:hidden;background:var(--line)}
.img img{width:100%;height:100%;object-fit:cover}.t{font-size:14px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.price{font-weight:700}.tag{position:absolute;top:8px;inset-inline-start:8px;background:var(--ink);color:var(--bg);font-size:12px;padding:2px 8px;border-radius:8px}
.product{max-width:720px;margin:0 auto;padding:0 16px 32px}.photos{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory}
.photos img{width:85%;max-width:420px;aspect-ratio:4/5;object-fit:cover;border-radius:16px;scroll-snap-align:start;flex:none}
.product .actions{justify-content:flex-start;padding:8px 0}.back{display:inline-block;padding:16px}
p.tag{position:static;display:inline-block}
</style>${pixels}
</head><body>${page.body}
<footer class="muted small center" style="padding:16px">على <a href="https://fatrina.app" style="color:var(--accent)">فاترينة</a> · ادفع عند الاستلام</footer>
</body></html>`;
    // A page (not the JSON API): its own CSP allowing images, Google Fonts and the pixels.
    res
      .status(200)
      .setHeader('Content-Security-Policy', "default-src 'none'; img-src * data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline' https://connect.facebook.net https://analytics.tiktok.com; connect-src https://*.facebook.com https://*.facebook.net https://*.tiktok.com https://*.tiktokw.us; frame-ancestors 'none'; base-uri 'none'")
      .setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
      .type('html')
      .send(html);
  }

  private notFound(res: Response) {
    res
      .status(404)
      .type('html')
      .send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مش موجود</title><body style="font-family:system-ui;text-align:center;padding:48px">الصفحة دي مش موجودة أو المتجر مش متاح دلوقتي.</body></html>');
  }
}

@Module({ controllers: [StorefrontController] })
export class StorefrontModule {}

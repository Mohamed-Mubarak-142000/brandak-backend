import { Controller, Get, Module, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '@/common/decorators';
import { LEGAL } from './legal-content';

type Doc = { title: string; intro: string; sections: readonly { title: string; body?: string; points?: readonly string[] }[] };

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Public legal pages (privacy, terms, account deletion) — Google Play needs them at a URL,
 * not only inside the app. Same text as the app (scripts/sync-legal.ts).
 */
@ApiExcludeController()
@Controller()
export class LegalController {
  @Public()
  @Get('privacy')
  privacy(@Res() res: Response) {
    this.send(res, LEGAL.privacy, 'privacy');
  }

  @Public()
  @Get('terms')
  terms(@Res() res: Response) {
    this.send(res, LEGAL.terms, 'terms');
  }

  @Public()
  @Get('delete-account')
  deleteAccount(@Res() res: Response) {
    this.send(
      res,
      {
        title: 'حذف حساب فاترينة',
        intro: 'تقدر تمسح حسابك على فاترينة وكل بياناتك الشخصية في أي وقت.',
        sections: [
          {
            title: 'من التطبيق',
            points: [
              'افتح تطبيق فاترينة وسجّل دخول.',
              'ادخل على «حسابي» › «الإعدادات» › «حذف الحساب».',
              'اكتب كلمة السر للتأكيد ودوس «احذف حسابي».',
            ],
          },
          {
            title: 'من غير التطبيق',
            body: `ابعت إيميل لـ ${LEGAL.supportEmail} من نفس البريد المسجل بيه، وعنوانه «حذف حساب»، وهنمسحه خلال 7 أيام.`,
          },
          {
            title: 'إيه اللي بيتمسح',
            points: [
              'الاسم والبريد الإلكتروني ورقم الموبايل وكلمة السر.',
              'عناوين التوصيل والسلة والمفضلة وتنبيهات الأسعار والمتاجر اللي بتتابعها.',
              'بياناتك الشخصية جوه طلباتك القديمة (الاسم والرقم والعنوان).',
            ],
          },
          {
            title: 'إيه اللي بيفضل',
            points: [
              'سجل الطلبات عند المتاجر (المنتجات والمبالغ) من غير بياناتك الشخصية، عشان الحسابات والضرائب.',
              'التقييمات اللي كتبتها بتفضل باسم «مستخدم محذوف».',
              'لو عندك طلب لسه في الطريق، لازم يوصل أو تلغيه الأول. ولو عندك متجر، تواصل مع الدعم عشان نقفله ونسوّي المستحقات.',
            ],
          },
        ],
      },
      'delete',
    );
  }

  private send(res: Response, doc: Doc, active: 'privacy' | 'terms' | 'delete') {
    const sections = doc.sections
      .map(
        (s) => `<section><h2>${esc(s.title)}</h2>${s.body ? `<p>${esc(s.body)}</p>` : ''}${
          s.points?.length ? `<ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''
        }</section>`,
      )
      .join('');
    const link = (href: string, label: string, key: string) => `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`;
    const html = `<!doctype html>
<html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title)} | فاترينة</title>
<meta name="description" content="${esc(doc.intro)}">
<style>
:root{--bg:#FFFBF7;--surface:#fff;--ink:#2A1D14;--ink2:#6B5A4E;--line:#F0E4D8;--accent:#C2500F}
@media (prefers-color-scheme:dark){:root{--bg:#17110D;--surface:#211812;--ink:#F7EEE6;--ink2:#C2B2A5;--line:#3A2C22;--accent:#F7843F}}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,"Segoe UI",Tahoma,sans-serif;background:var(--bg);color:var(--ink);line-height:1.8}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px}
nav a{color:var(--ink2);text-decoration:none}nav a[aria-current]{color:var(--accent);font-weight:700}
h1{font-size:28px;margin:16px 0 4px}h2{font-size:19px;margin:28px 0 6px}.muted{color:var(--ink2)}
section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px 18px 10px;margin-top:14px}ul{padding-inline-start:20px;margin:6px 0}
</style></head><body><main>
<nav>${link('/privacy', 'سياسة الخصوصية', 'privacy')}${link('/terms', 'الشروط والأحكام', 'terms')}${link('/delete-account', 'حذف الحساب', 'delete')}</nav>
<h1>${esc(doc.title)}</h1><p class="muted">${esc(doc.intro)}</p>${sections}
<p class="muted">آخر تحديث: ${esc(LEGAL.updated)} · للتواصل: <a href="mailto:${esc(LEGAL.supportEmail)}">${esc(LEGAL.supportEmail)}</a></p>
</main></body></html>`;
    res
      .status(200)
      .setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
      .setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600')
      .type('html')
      .send(html);
  }
}

@Module({ controllers: [LegalController] })
export class LegalModule {}

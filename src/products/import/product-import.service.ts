import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BrandsService } from '@/brands/brands.service';
import { CategoriesService } from '@/categories/categories.service';
import { ProductStatus } from '@/common/enums';
import { normalizeSearchText } from '@/common/utils/text';
import { Product } from '../product.schema';
import { ProductsService } from '../products.service';
import { readSheet, SheetRow } from './sheet';

export interface ImportVariant {
  size: string | null;
  color: string | null;
  sku: string | null;
  price: number | null;
  stock: number;
}

/** One product as read from the file, with what is wrong with it (if anything). */
export interface ImportItem {
  key: string;
  lines: number[];
  title: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  compareAtPrice: number | null;
  tags: string[];
  imageUrls: string[];
  /** Same order as imageUrls: the row colour the photo was listed on (null = every colour). */
  imageColors: (string | null)[];
  variants: ImportVariant[];
  /** "ready" will be created; "duplicate" already exists in the store and is skipped. */
  state: 'ready' | 'invalid' | 'duplicate';
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  items: ImportItem[];
  summary: {
    rows: number;
    products: number;
    ready: number;
    invalid: number;
    duplicates: number;
    withImages: number;
    /** How many more products the current plan lets the store publish; null = no active plan. */
    publishSlots: number | null;
  };
}

export interface ImportResult {
  created: { id: string; title: string; status: ProductStatus; imageUrls: string[]; imageColors: (string | null)[] }[];
  skipped: { title: string; lines: number[]; reason: string }[];
  published: number;
  drafts: number;
}

const MAX_VARIANTS = 100;
const MAX_IMAGES = 10;

const num = (s?: string) => {
  if (s == null || s === '') return null;
  const n = Number(toLatinDigits(s).replace(/[,\s]/g, '').replace(/(ج\.?م|جنيه|egp|le)$/i, ''));
  return Number.isFinite(n) ? n : NaN;
};
const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٫/g, '.');
const norm = (s: string) => normalizeSearchText(s);

@Injectable()
export class ProductImportService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<Product>,
    private readonly productsService: ProductsService,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
  ) {}

  /** Reads and checks the file without saving anything. */
  async preview(brandId: string, buffer: Buffer, filename: string): Promise<ImportPreview> {
    const rows = await readSheet(buffer, filename);
    const items = await this.build(brandId, rows);
    const publishSlots = await this.productsService.publishSlots(brandId);
    return {
      items,
      summary: {
        rows: rows.length,
        products: items.length,
        ready: items.filter((i) => i.state === 'ready').length,
        invalid: items.filter((i) => i.state === 'invalid').length,
        duplicates: items.filter((i) => i.state === 'duplicate').length,
        withImages: items.filter((i) => i.state === 'ready' && i.imageUrls.length).length,
        publishSlots,
      },
    };
  }

  /**
   * Creates every ready product in one insert. Publishing fills the plan's free slots first and
   * keeps the rest as drafts. Images are fetched afterwards, one product per request, so a big
   * file never runs into the request time limit.
   */
  async commit(brandId: string, buffer: Buffer, filename: string, publish: boolean): Promise<ImportResult> {
    const { items, summary } = await this.preview(brandId, buffer, filename);
    const ready = items.filter((i) => i.state === 'ready');
    let slots = publish ? (summary.publishSlots ?? 0) : 0;

    const docs = ready.map((item) => {
      // A product without photos stays a draft: it would show as an empty box in the store.
      const status = slots > 0 && item.imageUrls.length ? ProductStatus.ACTIVE : ProductStatus.DRAFT;
      if (status === ProductStatus.ACTIVE) slots--;
      const variants = item.variants.map((v) => ({
        _id: new Types.ObjectId(),
        size: v.size ?? undefined,
        color: v.color ?? undefined,
        sku: v.sku ?? undefined,
        price: v.price,
        stock: v.stock,
      }));
      return {
        brandId: new Types.ObjectId(brandId),
        categoryId: new Types.ObjectId(item.categoryId!),
        title: item.title,
        description: item.description,
        images: [],
        price: item.price!,
        compareAtPrice: item.compareAtPrice,
        variants,
        tags: item.tags,
        status: ProductStatus.DRAFT,
        intendedStatus: status,
        totalStock: variants.reduce((s, v) => s + v.stock, 0),
        searchText: norm([item.title, ...item.tags].join(' ')),
      };
    });

    // Everything goes in as a draft. Products meant to be published go live in
    // ProductsService.importImages once their photos are in, so nobody sees an empty product.
    const inserted = docs.length ? await this.products.insertMany(docs.map(({ intendedStatus: _, ...d }) => d)) : [];

    return {
      created: inserted.map((p, i) => ({
        id: p._id.toString(),
        title: p.title,
        status: docs[i].intendedStatus,
        imageUrls: ready[i].imageUrls,
        imageColors: ready[i].imageColors,
      })),
      skipped: items
        .filter((i) => i.state !== 'ready')
        .map((i) => ({ title: i.title || '—', lines: i.lines, reason: i.state === 'duplicate' ? 'موجود بالفعل في متجرك' : i.errors.join('، ') })),
      published: docs.filter((d) => d.intendedStatus === ProductStatus.ACTIVE).length,
      drafts: docs.filter((d) => d.intendedStatus === ProductStatus.DRAFT).length,
    };
  }

  /** Groups rows into products (same name = same product) and validates each one. */
  private async build(brandId: string, rows: SheetRow[]): Promise<ImportItem[]> {
    const brand = await this.brands.getById(brandId);
    const cats = await this.categories.listActive(brand.storeType);
    const byName = new Map<string, { id: string; name: string }>();
    for (const c of cats) {
      const ref = { id: c._id.toString(), name: c.nameAr };
      for (const n of [c.nameAr, c.nameEn, c.slug]) if (n) byName.set(norm(n), ref);
    }
    const brandCats = brand.categoryIds.map((id) => id.toString());
    const defaultCat = brandCats.length === 1 ? cats.find((c) => c._id.toString() === brandCats[0]) : undefined;

    const existing = new Set(
      (await this.products.find({ brandId: new Types.ObjectId(brandId), status: { $ne: ProductStatus.ARCHIVED } }).select('title').lean()).map((p) =>
        norm(p.title),
      ),
    );

    const groups = new Map<string, SheetRow[]>();
    rows.forEach((r, i) => {
      const key = r.values.title ? norm(r.values.title) : `__row${i}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    });

    return [...groups.entries()].map(([key, group]) => {
      const first = (id: keyof SheetRow['values']) => group.find((r) => r.values[id])?.values[id] ?? '';
      const errors: string[] = [];
      const warnings: string[] = [];
      const lines = group.map((r) => r.line);
      const at = (r: SheetRow) => (group.length > 1 ? ` (صف ${r.line})` : '');

      const title = first('title').replace(/\s+/g, ' ').trim();
      if (title.length < 2) errors.push('اسم المنتج ناقص أو قصير');
      else if (title.length > 120) errors.push('اسم المنتج أطول من 120 حرف');

      const price = num(first('price'));
      if (price == null) errors.push('السعر ناقص');
      else if (Number.isNaN(price) || price < 1 || price > 1_000_000) errors.push('السعر لازم يكون رقم من 1 لـ 1,000,000');
      const compareAt = num(first('compareAtPrice'));
      if (compareAt != null && (Number.isNaN(compareAt) || (price != null && compareAt <= price))) {
        errors.push('السعر قبل الخصم لازم يكون رقم أكبر من السعر');
      }

      let categoryId: string | null = null;
      let categoryName: string | null = null;
      const catText = first('category');
      if (catText) {
        const found = byName.get(norm(catText));
        if (found) {
          categoryId = found.id;
          categoryName = found.name;
          if (brandCats.length && !brandCats.includes(found.id)) warnings.push(`القسم "${found.name}" مش من أقسام متجرك`);
        } else errors.push(`القسم "${catText}" مش موجود. اكتبه زي شيت الأقسام في القالب`);
      } else if (defaultCat) {
        categoryId = defaultCat._id.toString();
        categoryName = defaultCat.nameAr;
      } else errors.push('اكتب القسم (متجرك ليه أكتر من قسم)');

      const variants: ImportVariant[] = [];
      const seen = new Set<string>();
      for (const r of group) {
        const v = r.values;
        const stock = num(v.stock);
        if (stock == null) errors.push(`المخزون ناقص${at(r)}`);
        else if (Number.isNaN(stock) || stock < 0 || stock > 100_000 || !Number.isInteger(stock)) errors.push(`المخزون لازم يكون رقم صحيح من 0 لـ 100,000${at(r)}`);
        const vPrice = num(v.variantPrice);
        if (vPrice != null && (Number.isNaN(vPrice) || vPrice < 0)) errors.push(`سعر المقاس مش رقم صحيح${at(r)}`);
        const size = v.size?.slice(0, 30) ?? null;
        const color = v.color?.slice(0, 30) ?? null;
        const combo = `${norm(size ?? '')}|${norm(color ?? '')}`;
        if (seen.has(combo)) errors.push(`المقاس واللون متكررين${at(r)}`);
        seen.add(combo);
        variants.push({ size, color, sku: v.sku?.slice(0, 60) ?? null, price: vPrice, stock: stock && !Number.isNaN(stock) ? stock : 0 });
      }
      if (variants.length > MAX_VARIANTS) errors.push(`لحد ${MAX_VARIANTS} مقاس/لون للمنتج`);

      const tags = [...new Set(group.flatMap((r) => (r.values.tags ?? '').split(/[,،]/).map((t) => t.trim().slice(0, 30)).filter(Boolean)))].slice(0, 20);

      // Photos on a row with a colour belong to that colour; the customer sees them when picking it.
      const listed = group.flatMap((r) =>
        (r.values.images ?? '')
          .split(/[\s,،]+/)
          .filter(Boolean)
          .map((url) => ({ url, color: r.values.color?.slice(0, 30) ?? null })),
      );
      const pairs = listed.filter((p, i) => /^https?:\/\/\S+$/i.test(p.url) && listed.findIndex((q) => q.url === p.url) === i);
      const imageUrls = pairs.map((p) => p.url);
      if (imageUrls.length < new Set(listed.map((p) => p.url)).size) warnings.push('في روابط صور مش صحيحة وهتتشال');
      if (imageUrls.length > MAX_IMAGES) warnings.push(`أول ${MAX_IMAGES} صور بس هيتضافوا`);
      if (!imageUrls.length) warnings.push('من غير صور: هيتحفظ مسودة، ضيف الصور بعدين');

      const description = first('description').slice(0, 5000);
      const duplicate = !errors.length && existing.has(norm(title));

      return {
        key,
        lines,
        title,
        description,
        categoryId,
        categoryName,
        price: price != null && !Number.isNaN(price) ? price : null,
        compareAtPrice: compareAt != null && !Number.isNaN(compareAt) ? compareAt : null,
        tags,
        imageUrls: imageUrls.slice(0, MAX_IMAGES),
        imageColors: pairs.slice(0, MAX_IMAGES).map((p) => p.color),
        variants,
        state: errors.length ? 'invalid' : duplicate ? 'duplicate' : 'ready',
        errors,
        warnings,
      } satisfies ImportItem;
    });
  }
}

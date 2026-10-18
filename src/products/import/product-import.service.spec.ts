import { Types } from 'mongoose';
import { ProductStatus } from '@/common/enums';
import { ProductImportService } from './product-import.service';

const clothes = { _id: new Types.ObjectId(), nameAr: 'ملابس', nameEn: 'Clothing', slug: 'clothing', parentId: null };
const bags = { _id: new Types.ObjectId(), nameAr: 'شنط', nameEn: 'Bags', slug: 'bags', parentId: null };

function setup({ brandCats = [clothes._id], existing = [] as string[], slots = 5 as number | null } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const products = {
    find: () => ({ select: () => ({ lean: async () => existing.map((title) => ({ title })) }) }),
    insertMany: async (docs: Record<string, unknown>[]) => {
      inserted.push(...docs);
      return docs.map((d) => ({ ...d, _id: new Types.ObjectId() }));
    },
  };
  const service = new ProductImportService(
    products as never,
    { publishSlots: async () => slots } as never,
    { getById: async () => ({ storeType: 'BRAND', categoryIds: brandCats }) } as never,
    { listActive: async () => [clothes, bags] } as never,
  );
  return { service, inserted };
}

const BRAND_ID = new Types.ObjectId().toString();
const csv = (lines: string[]) => Buffer.from(lines.join('\n'));
const HEAD = 'اسم المنتج,السعر,السعر قبل الخصم,المقاس,اللون,المخزون,القسم,روابط الصور';

describe('ProductImportService', () => {
  it('groups rows with the same name into one product with variants', async () => {
    const { service } = setup();
    const { items, summary } = await service.preview(
      BRAND_ID,
      csv([HEAD, 'تيشيرت,350,450,M,أسود,10,,https://x.com/a.jpg', 'تيشيرت,,,L,أسود,٥,,', 'شنطة,600,,,,3,شنط,']),
      'p.csv',
    );
    expect(summary).toMatchObject({ rows: 3, products: 2, ready: 2, invalid: 0, publishSlots: 5 });
    expect(items[0]).toMatchObject({ title: 'تيشيرت', price: 350, compareAtPrice: 450, categoryName: 'ملابس', imageUrls: ['https://x.com/a.jpg'] });
    expect(items[0].variants).toEqual([
      { size: 'M', color: 'أسود', sku: null, price: null, stock: 10 },
      { size: 'L', color: 'أسود', sku: null, price: null, stock: 5 },
    ]);
    expect(items[1].warnings.join()).toContain('مش من أقسام متجرك');
  });

  it('reports row-level errors in Arabic', async () => {
    const { service } = setup({ brandCats: [clothes._id, bags._id] });
    const { items } = await service.preview(
      BRAND_ID,
      csv([HEAD, 'تيشيرت,abc,,M,,10,,', 'بنطلون,300,200,,,-1,أحذية,', 'جاكيت,500,,M,أسود,1,,', 'جاكيت,,,M,أسود,2,,']),
      'p.csv',
    );
    expect(items.map((i) => i.state)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(items[0].errors.join()).toContain('السعر');
    expect(items[1].errors.join()).toMatch(/قبل الخصم.*|المخزون/);
    expect(items[1].errors.join()).toContain('"أحذية" مش موجود');
    expect(items[2].errors.join()).toContain('متكررين');
  });

  it('skips products that already exist and saves the rest as drafts', async () => {
    const { service, inserted } = setup({ existing: ['شنطة'] });
    const res = await service.commit(BRAND_ID, csv([HEAD, 'تيشيرت,350,,,,10,,https://x.com/a.jpg', 'بنطلون,300,,,,4,,', 'شنطة,600,,,,3,,']), 'p.csv', true);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((d) => d.status === ProductStatus.DRAFT)).toBe(true);
    // Only the product with photos is queued for publishing; the one without stays a draft.
    expect(res.created.map((c) => c.status)).toEqual([ProductStatus.ACTIVE, ProductStatus.DRAFT]);
    expect(res.skipped).toEqual([{ title: 'شنطة', lines: [4], reason: 'موجود بالفعل في متجرك' }]);
  });

  it('does not queue more products for publishing than the plan allows', async () => {
    const { service } = setup({ slots: 1 });
    const res = await service.commit(BRAND_ID, csv([HEAD, 'منتج أ,100,,,,1,,https://x.com/1.jpg', 'منتج ب,100,,,,1,,https://x.com/2.jpg']), 'p.csv', true);
    expect(res.created.map((c) => c.status)).toEqual([ProductStatus.ACTIVE, ProductStatus.DRAFT]);
  });

  it('ties each photo to the colour of the row it was listed on', async () => {
    const { service } = setup();
    const { items } = await service.preview(
      BRAND_ID,
      csv([HEAD, 'تيشيرت,350,,M,أسود,10,,https://x.com/black.jpg', 'تيشيرت,,,M,أبيض,5,,https://x.com/white.jpg https://x.com/white2.jpg']),
      'p.csv',
    );
    expect(items[0].imageUrls).toEqual(['https://x.com/black.jpg', 'https://x.com/white.jpg', 'https://x.com/white2.jpg']);
    expect(items[0].imageColors).toEqual(['أسود', 'أبيض', 'أبيض']);
  });
});

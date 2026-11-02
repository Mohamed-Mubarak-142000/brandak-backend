import { StoreType } from '@/common/enums';
import { TAXONOMY, TaxonomyNode } from '@/seed/taxonomy';
import { checkAgainstTemplate, resolveTemplate, SIZE_PRESETS } from './category-template';

describe('resolveTemplate', () => {
  it('lets a sub-category override its parent and merges fields by key', () => {
    const t = resolveTemplate([
      { size: { label: 'المقاس', preset: 'apparel' }, specs: [{ key: 'material', labelAr: 'الخامة', type: 'text' }], units: ['قطعة', 'دستة'] },
      { size: { label: 'المقاس', preset: 'apparel-numeric', allowCustom: false }, specs: [{ key: 'material', labelAr: 'الخامة', type: 'text', required: true }] },
    ]);
    expect(t.size).toMatchObject({ label: 'المقاس', allowCustom: false, values: SIZE_PRESETS['apparel-numeric'].values });
    expect(t.specs).toEqual([{ key: 'material', labelAr: 'الخامة', type: 'text', required: true }]);
    expect(t.units).toEqual(['قطعة', 'دستة']);
  });

  it('turns an axis off with null and inherits when a field is left out', () => {
    const t = resolveTemplate([{ size: null, color: { label: 'الدرجة' } }, { specs: [] }]);
    expect(t.size).toBeNull();
    expect(t.color).toEqual({ label: 'الدرجة', allowCustom: true });
  });

  it('falls back to free size/colour and pieces when nothing is set', () => {
    const t = resolveTemplate([null, undefined]);
    expect(t.size).toMatchObject({ label: 'المقاس', allowCustom: true, values: [] });
    expect(t.units).toEqual(['قطعة']);
    expect(t.wholesale).toBe('optional');
  });

  it("adds the store type's own fields without replacing the category's", () => {
    const t = resolveTemplate([{ specs: [{ key: 'warranty', labelAr: 'ضمان الوكيل', type: 'number' }] }], StoreType.SHOWROOM);
    expect(t.specs.map((s) => s.key)).toEqual(['warranty', 'condition', 'delivery_install']);
    expect(t.specs[0].labelAr).toBe('ضمان الوكيل');
    expect(resolveTemplate([], StoreType.WAREHOUSE).wholesale).toBe('required');
  });
});

describe('checkAgainstTemplate', () => {
  const t = resolveTemplate([
    {
      size: { label: 'القطر', values: ['8 مم', '10 مم'], allowCustom: false },
      color: null,
      units: ['طن'],
      specs: [
        { key: 'brand', labelAr: 'الماركة', type: 'text', required: true },
        { key: 'warranty', labelAr: 'الضمان', type: 'number' },
        { key: 'grade', labelAr: 'الفرز', type: 'select', options: ['أول', 'تاني'] },
        { key: 'smart', labelAr: 'سمارت', type: 'boolean' },
      ],
    },
  ], StoreType.WAREHOUSE);

  it('cleans specs: drops unknown keys and blanks, coerces numbers and yes/no', () => {
    const { specs, problems } = checkAgainstTemplate(
      t,
      {
        specs: [
          { key: 'brand', value: ' حديد عز ' },
          { key: 'warranty', value: '12' },
          { key: 'smart', value: 'true' },
          { key: 'grade', value: '' },
          { key: 'nope', value: 'x' },
        ],
        variants: [{ size: '8 مم' }],
        unit: 'طن',
      },
      false,
    );
    expect(problems).toEqual([]);
    expect(specs).toEqual([
      { key: 'brand', value: 'حديد عز' },
      { key: 'warranty', value: 12 },
      { key: 'smart', value: true },
    ]);
  });

  it('only demands required fields and wholesale when publishing', () => {
    const input = { specs: [], variants: [{}], unit: 'طن' };
    expect(checkAgainstTemplate(t, input, false).problems).toEqual([]);
    expect(checkAgainstTemplate(t, input, true).problems.map((p) => p.code)).toEqual(['SPEC_REQUIRED', 'WHOLESALE_REQUIRED']);
    expect(checkAgainstTemplate(t, { ...input, specs: [{ key: 'brand', value: 'عز' }], wholesale: { minQty: 5 } }, true).problems).toEqual([]);
  });

  it('rejects values outside the template', () => {
    const codes = (input: Parameters<typeof checkAgainstTemplate>[1]) => checkAgainstTemplate(t, input, false).problems.map((p) => p.code);
    expect(codes({ variants: [{ size: '9 مم' }] })).toEqual(['INVALID_SIZE']);
    expect(codes({ variants: [{ color: 'أحمر' }] })).toEqual(['COLOR_NOT_ALLOWED']);
    expect(codes({ variants: [{}], unit: 'كيلو' })).toEqual(['INVALID_UNIT']);
    expect(codes({ variants: [{}], specs: [{ key: 'grade', value: 'تالت' }] })).toEqual(['INVALID_SPEC']);
    expect(codes({ variants: [{}], specs: [{ key: 'warranty', value: 'سنة' }] })).toEqual(['INVALID_SPEC']);
  });

  it('lets an older product keep sizes and colours its category no longer has', () => {
    const existingAxes = { sizes: ['XL'], colors: ['أحمر'] };
    const codes = (variants: { size?: string; color?: string }[]) => checkAgainstTemplate(t, { variants, existingAxes }, false).problems.map((p) => p.code);
    expect(codes([{ size: 'XL', color: 'أحمر' }, { size: '8 مم' }])).toEqual([]);
    expect(codes([{ size: 'XXL' }, { color: 'أزرق' }])).toEqual(['INVALID_SIZE', 'COLOR_NOT_ALLOWED']);
  });
});

describe('seeded taxonomy', () => {
  const all: { node: TaxonomyNode; depth: number; chain: TaxonomyNode[] }[] = [];
  const walk = (nodes: TaxonomyNode[], chain: TaxonomyNode[]) =>
    nodes.forEach((node) => {
      all.push({ node, depth: chain.length, chain: [...chain, node] });
      walk(node.children ?? [], [...chain, node]);
    });
  walk(TAXONOMY, []);

  it('has unique slugs and at most three levels', () => {
    const slugs = all.map((a) => a.node.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(Math.max(...all.map((a) => a.depth))).toBeLessThanOrEqual(2);
    slugs.forEach((s) => expect(s).toMatch(/^[a-z0-9-]{2,60}$/));
  });

  it('only uses known presets and select fields with choices', () => {
    for (const { node } of all) {
      const t = node.template;
      if (t?.size?.preset) expect(SIZE_PRESETS[t.size.preset]).toBeDefined();
      t?.specs?.forEach((s) => s.type === 'select' && expect(s.options?.length).toBeGreaterThan(0));
    }
  });

  it('gives every sub-category a usable template for each store type it is offered to', () => {
    for (const { chain } of all.filter((a) => !a.node.children?.length)) {
      const types = chain[0].storeTypes?.length ? chain[0].storeTypes : Object.values(StoreType);
      for (const type of types) {
        const t = resolveTemplate(chain.map((c) => c.template), type);
        expect(t.units.length).toBeGreaterThan(0);
        expect(new Set(t.specs.map((s) => s.key)).size).toBe(t.specs.length);
      }
    }
  });
});

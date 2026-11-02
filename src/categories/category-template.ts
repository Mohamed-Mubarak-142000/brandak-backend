import { StoreType } from '@/common/enums';

/**
 * A category's product template: what a store fills in when it adds a product there. Templates
 * are inherited down the tree — a sub-category only states what differs from its parent.
 *
 * Variants keep their two fields (`size`, `color`); the template renames them and lists their
 * values ("المساحة" 64GB/128GB for phones, "الحجم" for paint), so carts, orders, imports and the
 * product page work unchanged for every category.
 */
export type SpecType = 'text' | 'number' | 'select' | 'boolean';

export interface SpecDef {
  key: string;
  labelAr: string;
  type: SpecType;
  /** Choices for a select. */
  options?: string[];
  /** Shown after a number ("شهر", "لتر", "كجم"). */
  unit?: string;
  /** Needed before the product can be published. */
  required?: boolean;
  /** Customers can filter a category's products by it. */
  filterable?: boolean;
}

export interface SizeAxis {
  /** What the axis is called here: المقاس، السعة، المساحة، الحجم، الوزن... */
  label: string;
  /** A ready list from SIZE_PRESETS. */
  preset?: string;
  /** Extra or replacement values; with a preset they are added after it. */
  values?: string[];
  /** The store may type a value that is not in the list. */
  allowCustom?: boolean;
}

export interface ColorAxis {
  label: string;
  allowCustom?: boolean;
}

/** What an admin stores on a category. `undefined` inherits from the parent, `null` turns the axis off. */
export interface CategoryTemplate {
  size?: SizeAxis | null;
  color?: ColorAxis | null;
  specs?: SpecDef[];
  /** Selling units allowed here; the first is the default. */
  units?: string[];
  /** A size chart or measuring advice shown to customers. */
  sizeGuide?: string;
}

/** A template after inheritance, presets and the store type's own fields are applied. */
export interface ResolvedTemplate {
  size: (SizeAxis & { values: string[]; allowCustom: boolean }) | null;
  color: (ColorAxis & { allowCustom: boolean }) | null;
  specs: SpecDef[];
  units: string[];
  sizeGuide: string | null;
  wholesale: 'optional' | 'required';
}

export const SIZE_PRESETS: Record<string, { labelAr: string; values: string[] }> = {
  apparel: { labelAr: 'مقاسات ملابس (حروف)', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'فري سايز'] },
  'apparel-numeric': { labelAr: 'مقاسات بنطلون (أرقام)', values: ['28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42', '44'] },
  'women-numeric': { labelAr: 'مقاسات حريمي (أرقام)', values: ['34', '36', '38', '40', '42', '44', '46', '48', '50'] },
  'shoes-eu': { labelAr: 'مقاسات أحذية', values: ['35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  'kids-shoes': { labelAr: 'مقاسات أحذية أطفال', values: ['18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34'] },
  'kids-age': {
    labelAr: 'أعمار أطفال',
    values: ['0-3 شهور', '3-6 شهور', '6-12 شهر', '1-2 سنة', '2-3 سنين', '3-4 سنين', '4-5 سنين', '5-6 سنين', '7-8 سنين', '9-10 سنين', '11-12 سنة', '13-14 سنة'],
  },
  ring: { labelAr: 'مقاسات خواتم', values: ['14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'] },
  bed: { labelAr: 'مقاسات سراير ومفروشات', values: ['سنجل 90×190', '120×200', 'دبل 160×200', 'كينج 180×200', 'سوبر كينج 200×200'] },
  'phone-storage': { labelAr: 'مساحة تخزين', values: ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] },
  'laptop-config': { labelAr: 'رامات ومساحة', values: ['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '32GB / 1TB'] },
  'screen-inch': { labelAr: 'مقاس الشاشة', values: ['32 بوصة', '43 بوصة', '50 بوصة', '55 بوصة', '65 بوصة', '75 بوصة', '85 بوصة'] },
  'fridge-feet': { labelAr: 'سعة ثلاجة', values: ['10 قدم', '12 قدم', '14 قدم', '16 قدم', '18 قدم', '20 قدم', '24 قدم'] },
  'washer-kg': { labelAr: 'سعة غسالة', values: ['6 كجم', '7 كجم', '8 كجم', '9 كجم', '10 كجم', '12 كجم'] },
  'ac-hp': { labelAr: 'قدرة تكييف', values: ['1.5 حصان', '2.25 حصان', '3 حصان', '4 حصان', '5 حصان'] },
  'volume-ml': { labelAr: 'أحجام (مل)', values: ['30 مل', '50 مل', '100 مل', '200 مل', '250 مل', '500 مل', '1 لتر'] },
  'weight-g': { labelAr: 'أوزان', values: ['100 جم', '250 جم', '500 جم', '1 كجم', '2 كجم', '5 كجم', '10 كجم', '25 كجم', '50 كجم'] },
  'volume-l': { labelAr: 'عبوات (لتر)', values: ['0.5 لتر', '1 لتر', '1.5 لتر', '2 لتر', '3 لتر', '4 لتر', '5 لتر', '18 لتر', '20 لتر'] },
  tiles: { labelAr: 'مقاسات بلاط', values: ['20×20', '25×40', '30×60', '40×40', '45×45', '60×60', '60×120', '80×80', '120×120'] },
  tires: { labelAr: 'مقاسات كاوتش', values: ['165/65R13', '175/70R13', '185/65R14', '185/65R15', '195/65R15', '205/55R16', '215/60R16', '225/45R17', '235/65R17'] },
  'diaper-size': { labelAr: 'مقاسات حفاضات', values: ['1 (2-5 كجم)', '2 (3-6 كجم)', '3 (4-9 كجم)', '4 (7-18 كجم)', '5 (11-25 كجم)', '6 (+16 كجم)'] },
};

/** Units a store may sell by, offered by most templates. */
export const UNITS = [
  'قطعة', 'زوج', 'طقم', 'علبة', 'كرتونة', 'دستة', 'سيري', 'باكو', 'شريط', 'رزمة', 'كيلو', 'جرام', 'لتر', 'جالون', 'بستلة',
  'شيكارة', 'شوال', 'طن', 'متر', 'متر مربع', 'متر مكعب', 'لفة', 'ماسورة', 'ألف طوبة', 'نقلة',
];
export const DEFAULT_UNIT = 'قطعة';

/**
 * Store types sell differently: a warehouse always offers quantity prices, a showroom states
 * condition and warranty. These are added to every template the store sees.
 */
export const STORE_TYPE_PROFILES: Record<StoreType, { wholesale: 'optional' | 'required'; specs: SpecDef[] }> = {
  [StoreType.BRAND]: { wholesale: 'optional', specs: [] },
  [StoreType.SHOWROOM]: {
    wholesale: 'optional',
    specs: [
      { key: 'condition', labelAr: 'الحالة', type: 'select', options: ['جديد', 'كسر زيرو', 'مستعمل'], required: true, filterable: true },
      { key: 'warranty', labelAr: 'الضمان', type: 'number', unit: 'شهر', filterable: false },
      { key: 'delivery_install', labelAr: 'توصيل وتركيب', type: 'boolean' },
    ],
  },
  [StoreType.WAREHOUSE]: { wholesale: 'required', specs: [] },
  [StoreType.SHOP]: { wholesale: 'optional', specs: [] },
};

const DEFAULT_SIZE: SizeAxis = { label: 'المقاس', allowCustom: true };
const DEFAULT_COLOR: ColorAxis = { label: 'اللون', allowCustom: true };

/**
 * Applies templates from the root down (`chain[0]` is the top-level category). A child's value
 * replaces its parent's; specs merge by key, so a child can tighten or add one field.
 */
export function resolveTemplate(chain: (CategoryTemplate | null | undefined)[], storeType?: StoreType | null): ResolvedTemplate {
  let size: SizeAxis | null = DEFAULT_SIZE;
  let color: ColorAxis | null = DEFAULT_COLOR;
  let units: string[] = [];
  let sizeGuide: string | null = null;
  const specs = new Map<string, SpecDef>();
  for (const t of chain) {
    if (!t) continue;
    if (t.size !== undefined) size = t.size;
    if (t.color !== undefined) color = t.color;
    if (t.units?.length) units = t.units;
    if (t.sizeGuide !== undefined) sizeGuide = t.sizeGuide || null;
    for (const s of t.specs ?? []) specs.set(s.key, s);
  }
  const profile = STORE_TYPE_PROFILES[storeType ?? StoreType.BRAND];
  for (const s of profile.specs) if (!specs.has(s.key)) specs.set(s.key, s);

  return {
    size: size && {
      ...size,
      values: uniq([...(size.preset ? SIZE_PRESETS[size.preset]?.values ?? [] : []), ...(size.values ?? [])]),
      // With nothing to pick from, typing is the only way.
      allowCustom: size.allowCustom ?? true,
    },
    color: color && { ...color, allowCustom: color.allowCustom ?? true },
    specs: [...specs.values()],
    units: units.length ? units : [DEFAULT_UNIT],
    sizeGuide,
    wholesale: profile.wholesale,
  };
}

export type SpecValue = string | number | boolean;

export interface TemplateInput {
  specs?: { key: string; value: SpecValue }[];
  variants: { size?: string | null; color?: string | null }[];
  unit?: string | null;
  wholesale?: unknown;
  /**
   * Sizes and colours the product already had: a product filed before its category's template
   * changed keeps them on later edits (only new or moved products follow the template strictly).
   */
  existingAxes?: { sizes: string[]; colors: string[] };
}

export interface TemplateProblem {
  code: string;
  message: string;
}

/**
 * Checks a product against its resolved template. Returns the specs cleaned to the template
 * (unknown keys dropped, values coerced) plus any problems. `publishing` adds the checks that
 * only matter for a live product: required specs and a warehouse's quantity prices.
 */
export function checkAgainstTemplate(t: ResolvedTemplate, input: TemplateInput, publishing: boolean) {
  const problems: TemplateProblem[] = [];
  const byKey = new Map(t.specs.map((s) => [s.key, s]));
  const specs: { key: string; value: SpecValue }[] = [];

  for (const { key, value } of input.specs ?? []) {
    const def = byKey.get(key);
    if (!def || value === '' || value === null || value === undefined) continue;
    const v = coerceSpec(def, value);
    if (v === undefined) problems.push({ code: 'INVALID_SPEC', message: `«${def.labelAr}» value is not valid` });
    else if (!specs.some((s) => s.key === key)) specs.push({ key, value: v });
  }
  if (publishing) {
    for (const def of t.specs) {
      if (def.required && !specs.some((s) => s.key === def.key)) {
        problems.push({ code: 'SPEC_REQUIRED', message: `«${def.labelAr}» is required` });
      }
    }
    if (t.wholesale === 'required' && !input.wholesale) {
      problems.push({ code: 'WHOLESALE_REQUIRED', message: 'Warehouses must set a minimum order and quantity prices' });
    }
  }

  const kept = input.existingAxes;
  const sizes = (input.variants.map((v) => v.size?.trim()).filter(Boolean) as string[]).filter((s) => !kept?.sizes.includes(s));
  const colors = (input.variants.map((v) => v.color?.trim()).filter(Boolean) as string[]).filter((c) => !kept?.colors.includes(c));
  if (sizes.length && !t.size) problems.push({ code: 'SIZE_NOT_ALLOWED', message: 'This category has no sizes' });
  if (t.size && !t.size.allowCustom) {
    const bad = sizes.find((s) => !t.size!.values.includes(s));
    if (bad) problems.push({ code: 'INVALID_SIZE', message: `«${bad}» is not a valid ${t.size.label}` });
  }
  if (colors.length && !t.color) problems.push({ code: 'COLOR_NOT_ALLOWED', message: 'This category has no colours' });

  if (input.unit && !t.units.includes(input.unit)) {
    problems.push({ code: 'INVALID_UNIT', message: `Sell by one of: ${t.units.join(', ')}` });
  }
  return { specs, problems };
}

function coerceSpec(def: SpecDef, value: SpecValue): SpecValue | undefined {
  if (typeof value === 'object') return undefined;
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return value === 'true' ? true : value === 'false' ? false : undefined;
    case 'select': {
      const s = String(value).trim();
      return def.options?.includes(s) ? s : undefined;
    }
    default: {
      const s = String(value).trim().slice(0, 100);
      return s || undefined;
    }
  }
}

function uniq(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

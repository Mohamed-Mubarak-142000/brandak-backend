import { StoreType } from '@/common/enums';
import { CategoryTemplate, SpecDef } from '@/categories/category-template';

/**
 * The category tree: top-level sections (kept from the flat list, same slugs), their categories
 * and sub-categories. Each node's template only says what differs from its parent. Slugs are
 * global, so children carry their parent's prefix.
 */
export interface TaxonomyNode {
  slug: string;
  nameAr: string;
  nameEn: string;
  icon?: string;
  sortOrder?: number;
  /** Top-level only; sub-categories are offered to the same store types. */
  storeTypes?: StoreType[];
  template?: CategoryTemplate;
  children?: TaxonomyNode[];
}

const { BRAND, SHOWROOM, WAREHOUSE, SHOP } = StoreType;

const n = (slug: string, nameAr: string, nameEn: string, extra: Partial<TaxonomyNode> = {}): TaxonomyNode => ({ slug, nameAr, nameEn, ...extra });

// ---------- Reusable fields ----------

const brandSpec = (required = false): SpecDef => ({ key: 'brand', labelAr: 'الماركة', type: 'text', required, filterable: true });
const model: SpecDef = { key: 'model', labelAr: 'الموديل', type: 'text' };
const warranty: SpecDef = { key: 'warranty', labelAr: 'الضمان', type: 'number', unit: 'شهر' };
const origin: SpecDef = { key: 'origin', labelAr: 'بلد الصنع', type: 'select', options: ['مصري', 'صيني', 'تركي', 'أوروبي', 'أمريكي', 'كوري', 'ياباني', 'هندي', 'أخرى'], filterable: true };
const shelfLife: SpecDef = { key: 'shelf_life', labelAr: 'الصلاحية', type: 'text' };
const prepDays: SpecDef = { key: 'prep_days', labelAr: 'مدة التجهيز', type: 'number', unit: 'يوم' };
const madeToOrder: SpecDef = { key: 'made_to_order', labelAr: 'بيتعمل حسب الطلب', type: 'boolean' };
const customizable: SpecDef = { key: 'customizable', labelAr: 'ينفع يتكتب عليه اسم/تخصيص', type: 'boolean' };
const fabric: SpecDef = {
  key: 'material',
  labelAr: 'الخامة',
  type: 'select',
  options: ['قطن 100%', 'قطن', 'ليكرا', 'كتان', 'جينز', 'صوف', 'تريكو', 'شيفون', 'ستان', 'كريب', 'فيسكوز', 'بوليستر', 'جلد', 'جلد صناعي', 'قطيفة', 'مخلوط'],
  filterable: true,
};
const fit: SpecDef = { key: 'fit', labelAr: 'القصّة', type: 'select', options: ['عادي', 'سليم فيت', 'أوفرسايز', 'ريلاكس', 'واسع'], filterable: true };
const season: SpecDef = { key: 'season', labelAr: 'الموسم', type: 'select', options: ['صيفي', 'شتوي', 'كل المواسم'], filterable: true };
const shoeMaterial: SpecDef = { key: 'material', labelAr: 'الخامة', type: 'select', options: ['جلد طبيعي', 'جلد صناعي', 'شمواه', 'نبوك', 'قماش', 'شبك', 'رابر'], filterable: true };
const metal: SpecDef = { key: 'material', labelAr: 'الخامة', type: 'select', options: ['فضة 925', 'ذهب عيار 18', 'ذهب عيار 21', 'ستانلس ستيل', 'نحاس', 'مطلي', 'خرز', 'جلد', 'أخرى'], filterable: true };
const kitchenMaterial: SpecDef = { key: 'material', labelAr: 'الخامة', type: 'select', options: ['ستانلس ستيل', 'جرانيت', 'تيفال', 'ألومنيوم', 'صيني', 'زجاج', 'بايركس', 'بلاستيك', 'ميلامين', 'خشب', 'سيراميك'], filterable: true };
const woodMaterial: SpecDef = { key: 'material', labelAr: 'الخامة', type: 'select', options: ['خشب زان', 'خشب أرو', 'خشب موسكي', 'MDF', 'كونتر', 'معدن', 'خوص/راتان', 'بلاستيك'], filterable: true };
const pieces: SpecDef = { key: 'pieces', labelAr: 'عدد القطع', type: 'number', unit: 'قطعة' };
const toyAge: SpecDef = { key: 'age', labelAr: 'السن المناسب', type: 'select', options: ['0-12 شهر', '1-3 سنين', '3-5 سنين', '6-8 سنين', '9-12 سنة', '+12 سنة'], required: true, filterable: true };
const deviceCondition: SpecDef = { key: 'condition', labelAr: 'الحالة', type: 'select', options: ['جديد', 'كسر زيرو', 'مستعمل'], required: true, filterable: true };

const noSize = { size: null };
const noColor = { color: null };
const PIECE = ['قطعة', 'طقم', 'دستة'];
const PACKED = ['قطعة', 'علبة', 'كرتونة', 'دستة', 'باكو'];

// ---------- The tree ----------

const apparel: CategoryTemplate = {
  size: { label: 'المقاس', preset: 'apparel', allowCustom: true },
  color: { label: 'اللون', allowCustom: true },
  specs: [fabric, fit, season],
  units: ['قطعة', 'طقم', 'دستة', 'سيري'],
};
const trousers: CategoryTemplate = { size: { label: 'المقاس', preset: 'apparel-numeric', values: ['S', 'M', 'L', 'XL', 'XXL'], allowCustom: true } };
const womenNumeric: CategoryTemplate = { size: { label: 'المقاس', preset: 'women-numeric', values: ['S', 'M', 'L', 'XL', 'XXL'], allowCustom: true } };
const kidsAge: CategoryTemplate = { size: { label: 'السن', preset: 'kids-age', allowCustom: true } };

/** Clothing departments, shared by brands' "Fashion" and warehouses' "Wholesale clothing". */
const clothingChildren = (p: string): TaxonomyNode[] => [
  n(`${p}-men`, 'رجالي', 'Men', {
    children: [
      n(`${p}-men-tshirts`, 'تيشيرتات', 'T-shirts'),
      n(`${p}-men-shirts`, 'قمصان', 'Shirts'),
      n(`${p}-men-polo`, 'بولو', 'Polo'),
      n(`${p}-men-trousers`, 'بناطيل', 'Trousers', { template: trousers }),
      n(`${p}-men-jeans`, 'جينز', 'Jeans', { template: trousers }),
      n(`${p}-men-shorts`, 'شورتات', 'Shorts'),
      n(`${p}-men-hoodies`, 'هوديز وسويت شيرت', 'Hoodies & Sweatshirts'),
      n(`${p}-men-jackets`, 'جواكت وجاكيتات', 'Jackets & Coats'),
      n(`${p}-men-suits`, 'بدل وبليزر', 'Suits & Blazers', { template: { size: { label: 'المقاس', values: ['46', '48', '50', '52', '54', '56', '58', '60'], allowCustom: true } } }),
      n(`${p}-men-tracksuits`, 'ترينجات', 'Tracksuits'),
      n(`${p}-men-galabeya`, 'جلابيات', 'Galabeyas'),
      n(`${p}-men-underwear`, 'ملابس داخلية وشرابات', 'Underwear & Socks'),
    ],
  }),
  n(`${p}-women`, 'حريمي', 'Women', {
    children: [
      n(`${p}-women-tops`, 'بلوزات وتوبات', 'Blouses & Tops'),
      n(`${p}-women-dresses`, 'فساتين', 'Dresses'),
      n(`${p}-women-skirts`, 'جيبات', 'Skirts', { template: womenNumeric }),
      n(`${p}-women-trousers`, 'بناطيل وجينز', 'Trousers & Jeans', { template: womenNumeric }),
      n(`${p}-women-abayas`, 'عبايات', 'Abayas'),
      n(`${p}-women-prayer`, 'إسدالات وملابس صلاة', 'Prayer Wear', { template: { size: { label: 'المقاس', values: ['فري سايز', 'M', 'L', 'XL', 'XXL'], allowCustom: true } } }),
      n(`${p}-women-cardigans`, 'كارديجان وجواكت', 'Cardigans & Jackets'),
      n(`${p}-women-sets`, 'أطقم وترينجات', 'Sets & Tracksuits'),
      n(`${p}-women-sleepwear`, 'بيجامات وقمصان نوم', 'Sleepwear'),
      n(`${p}-women-lingerie`, 'ملابس داخلية', 'Lingerie', { template: { size: { label: 'المقاس', values: ['70', '75', '80', '85', '90', '95', '100', 'S', 'M', 'L', 'XL'], allowCustom: true } } }),
      n(`${p}-women-hijab`, 'طرح وإيشاربات', 'Hijabs & Scarves', { template: { ...noSize } }),
    ],
  }),
  n(`${p}-kids`, 'أطفال', 'Kids', {
    template: kidsAge,
    children: [
      n(`${p}-kids-girls`, 'بناتي', 'Girls'),
      n(`${p}-kids-boys`, 'ولادي', 'Boys'),
      n(`${p}-kids-baby`, 'بيبي (لحد سنتين)', 'Baby', { template: { size: { label: 'السن', values: ['بريميتشر', '0-3 شهور', '3-6 شهور', '6-9 شهور', '9-12 شهر', '12-18 شهر', '18-24 شهر'], allowCustom: true } } }),
      n(`${p}-kids-school`, 'يونيفورم مدارس', 'School Uniforms'),
    ],
  }),
  n(`${p}-sport`, 'ملابس رياضية', 'Sportswear', {
    children: [
      n(`${p}-sport-tops`, 'تيشيرتات رياضية', 'Sport Tops'),
      n(`${p}-sport-tracksuits`, 'ترينجات', 'Tracksuits'),
      n(`${p}-sport-leggings`, 'ليجن وبناطيل رياضية', 'Leggings & Pants'),
      n(`${p}-sport-shorts`, 'شورتات رياضية', 'Sport Shorts'),
    ],
  }),
];

export const TAXONOMY: TaxonomyNode[] = [
  n('fashion', 'ملابس', 'Fashion', {
    icon: 'shirt',
    sortOrder: 1,
    storeTypes: [BRAND, SHOWROOM, SHOP],
    template: apparel,
    children: clothingChildren('fashion'),
  }),

  n('shoes-bags', 'أحذية وشنط', 'Shoes & Bags', {
    icon: 'footprints',
    sortOrder: 2,
    storeTypes: [BRAND, SHOP],
    template: { size: { label: 'المقاس', preset: 'shoes-eu', allowCustom: true }, color: { label: 'اللون', allowCustom: true }, specs: [shoeMaterial], units: ['زوج', 'قطعة'] },
    children: [
      n('shoes-men', 'أحذية رجالي', "Men's Shoes", {
        children: [
          n('shoes-men-casual', 'كاجوال', 'Casual'),
          n('shoes-men-classic', 'كلاسيك', 'Classic'),
          n('shoes-men-sneakers', 'كوتشيات رياضية', 'Sneakers'),
          n('shoes-men-sandals', 'صنادل وشباشب', 'Sandals & Slippers'),
          n('shoes-men-boots', 'بوت', 'Boots'),
        ],
      }),
      n('shoes-women', 'أحذية حريمي', "Women's Shoes", {
        children: [
          n('shoes-women-heels', 'كعب عالي', 'Heels'),
          n('shoes-women-flats', 'فلات وباليرينا', 'Flats'),
          n('shoes-women-sneakers', 'كوتشيات', 'Sneakers'),
          n('shoes-women-sandals', 'صنادل وشباشب', 'Sandals & Slippers'),
          n('shoes-women-boots', 'بوت وهاف بوت', 'Boots'),
        ],
      }),
      n('shoes-kids', 'أحذية أطفال', "Kids' Shoes", { template: { size: { label: 'المقاس', preset: 'kids-shoes', allowCustom: true } } }),
      n('bags', 'شنط', 'Bags', {
        template: { ...noSize, units: ['قطعة'], specs: [{ ...shoeMaterial, options: ['جلد طبيعي', 'جلد صناعي', 'قماش', 'جينز', 'كروشيه', 'قش', 'بلاستيك'] }] },
        children: [
          n('bags-hand', 'شنط يد', 'Handbags'),
          n('bags-cross', 'كروس', 'Crossbody'),
          n('bags-backpacks', 'شنط ضهر', 'Backpacks'),
          n('bags-clutch', 'كلاتش وسهرة', 'Clutches'),
          n('bags-travel', 'شنط سفر', 'Travel Bags', { template: { size: { label: 'الحجم', values: ['كابينة 20 بوصة', 'وسط 24 بوصة', 'كبير 28 بوصة', 'طقم 3 قطع'], allowCustom: true } } }),
          n('bags-wallets', 'محافظ وجرابات', 'Wallets'),
        ],
      }),
    ],
  }),

  n('accessories', 'إكسسوارات', 'Accessories', {
    icon: 'watch',
    sortOrder: 3,
    storeTypes: [BRAND, SHOP],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, specs: [metal], units: ['قطعة', 'طقم'] },
    children: [
      n('acc-watches', 'ساعات', 'Watches', { template: { specs: [brandSpec(), { key: 'movement', labelAr: 'النوع', type: 'select', options: ['أنالوج', 'ديجيتال', 'سمارت'] }] } }),
      n('acc-glasses', 'نظارات', 'Sunglasses & Eyewear'),
      n('acc-jewelry', 'مجوهرات وفضة', 'Jewelry', {
        children: [
          n('acc-jewelry-rings', 'خواتم', 'Rings', { template: { size: { label: 'المقاس', preset: 'ring', allowCustom: true } } }),
          n('acc-jewelry-necklaces', 'سلاسل وكوليهات', 'Necklaces'),
          n('acc-jewelry-bracelets', 'أساور وانسيالات', 'Bracelets'),
          n('acc-jewelry-earrings', 'حلقان', 'Earrings'),
          n('acc-jewelry-sets', 'أطقم', 'Sets'),
        ],
      }),
      n('acc-hair', 'إكسسوارات شعر', 'Hair Accessories'),
      n('acc-belts', 'أحزمة', 'Belts', { template: { size: { label: 'المقاس', values: ['90 سم', '100 سم', '110 سم', '120 سم', '130 سم'], allowCustom: true } } }),
      n('acc-caps', 'كابات وطواقي', 'Caps & Hats'),
      n('acc-men', 'إكسسوارات رجالي', "Men's Accessories"),
    ],
  }),

  n('beauty', 'عناية وجمال', 'Beauty & Care', {
    icon: 'sparkles',
    sortOrder: 4,
    storeTypes: [BRAND],
    template: { size: { label: 'الحجم', preset: 'volume-ml', allowCustom: true }, ...noColor, specs: [brandSpec(), origin, shelfLife], units: ['قطعة', 'علبة', 'طقم'] },
    children: [
      n('beauty-makeup', 'مكياج', 'Makeup', { template: { color: { label: 'الدرجة', allowCustom: true } } }),
      n('beauty-skin', 'عناية بالبشرة', 'Skincare', { template: { specs: [{ key: 'skin_type', labelAr: 'نوع البشرة', type: 'select', options: ['كل الأنواع', 'دهنية', 'جافة', 'مختلطة', 'حساسة'], filterable: true }] } }),
      n('beauty-hair', 'عناية بالشعر', 'Haircare'),
      n('beauty-perfume', 'عطور', 'Perfumes', { template: { specs: [{ key: 'for', labelAr: 'لمين', type: 'select', options: ['رجالي', 'حريمي', 'للجنسين'], filterable: true }] } }),
      n('beauty-body', 'عناية بالجسم', 'Body Care'),
      n('beauty-tools', 'أدوات تجميل', 'Beauty Tools', { template: { ...noSize, color: { label: 'اللون', allowCustom: true } } }),
    ],
  }),

  n('handmade', 'هاند ميد', 'Handmade', {
    icon: 'hand',
    sortOrder: 5,
    storeTypes: [BRAND],
    template: { specs: [madeToOrder, prepDays, customizable], units: ['قطعة', 'طقم'] },
    children: [
      n('handmade-crochet', 'كروشيه وتريكو', 'Crochet & Knitting'),
      n('handmade-candles', 'شموع ومعطرات', 'Candles & Scents', { template: { ...noSize } }),
      n('handmade-resin', 'خشب وريزن', 'Wood & Resin'),
      n('handmade-jewelry', 'إكسسوارات هاند ميد', 'Handmade Jewelry', { template: { ...noSize } }),
      n('handmade-embroidery', 'تطريز ومطرزات', 'Embroidery'),
      n('handmade-soap', 'صابون طبيعي', 'Natural Soap', { template: { size: { label: 'الوزن', preset: 'weight-g', allowCustom: true }, ...noColor } }),
      n('handmade-art', 'رسم ولوحات', 'Art & Paintings', { template: { size: { label: 'المقاس', values: ['20×30 سم', '30×40 سم', '40×60 سم', '50×70 سم', '60×90 سم'], allowCustom: true } } }),
    ],
  }),

  n('kids', 'أطفال', 'Kids', {
    icon: 'baby',
    sortOrder: 6,
    storeTypes: [BRAND],
    template: { ...kidsAge, units: ['قطعة', 'طقم', 'علبة'] },
    children: [
      n('kids-clothes', 'ملابس أطفال', "Kids' Clothes", { template: { specs: [fabric, season] } }),
      n('kids-baby-care', 'مستلزمات بيبي', 'Baby Care', { template: { size: { label: 'المقاس', preset: 'diaper-size', allowCustom: true }, ...noColor, specs: [brandSpec()] } }),
      n('kids-feeding', 'رضاعة وأكل', 'Feeding', { template: { size: { label: 'الحجم', values: ['120 مل', '150 مل', '240 مل', '260 مل', '330 مل'], allowCustom: true }, specs: [brandSpec()] } }),
      n('kids-toys', 'ألعاب', 'Toys', { template: { ...noSize, specs: [toyAge] } }),
      n('kids-gear', 'عربيات وكراسي', 'Strollers & Car Seats', { template: { ...noSize, specs: [brandSpec(), toyAge] } }),
      n('kids-school', 'مستلزمات مدرسة', 'School Supplies', { template: { ...noSize } }),
    ],
  }),

  n('food', 'أكل وحلويات', 'Food & Sweets', {
    icon: 'cake',
    sortOrder: 7,
    storeTypes: [BRAND],
    template: { size: { label: 'الحجم', values: ['صغير', 'وسط', 'كبير', '250 جم', '500 جم', '1 كيلو', '2 كيلو'], allowCustom: true }, ...noColor, specs: [shelfLife, prepDays, madeToOrder], units: ['قطعة', 'علبة', 'كيلو', 'طقم'] },
    children: [
      n('food-cakes', 'تورت وكيك', 'Cakes', { template: { size: { label: 'الحجم', values: ['ميني', '6 أفراد', '8 أفراد', '12 فرد', '20 فرد'], allowCustom: true }, specs: [{ key: 'flavor', labelAr: 'النكهة', type: 'text' }] } }),
      n('food-sweets', 'حلويات شرقي وغربي', 'Sweets'),
      n('food-bakery', 'مخبوزات', 'Bakery'),
      n('food-homemade', 'أكل بيتي', 'Home Cooking'),
      n('food-pickles', 'مخللات ومربى', 'Pickles & Jams'),
      n('food-honey', 'عسل وتمور', 'Honey & Dates'),
      n('food-coffee', 'قهوة وبن', 'Coffee', { template: { size: { label: 'الوزن', preset: 'weight-g', allowCustom: true }, specs: [{ key: 'roast', labelAr: 'التحميص', type: 'select', options: ['فاتح', 'وسط', 'غامق'] }] } }),
      n('food-healthy', 'أكل صحي', 'Healthy Food'),
    ],
  }),

  n('gifts', 'هدايا', 'Gifts', {
    icon: 'gift',
    sortOrder: 8,
    storeTypes: [BRAND],
    template: { ...noSize, specs: [customizable, prepDays], units: ['قطعة', 'طقم'] },
    children: [
      n('gifts-boxes', 'بوكسات هدايا', 'Gift Boxes'),
      n('gifts-flowers', 'ورد وتنسيقات', 'Flowers'),
      n('gifts-personalized', 'هدايا بالاسم', 'Personalized Gifts'),
      n('gifts-occasions', 'هدايا مناسبات', 'Occasion Gifts', { template: { specs: [{ key: 'occasion', labelAr: 'المناسبة', type: 'select', options: ['عيد ميلاد', 'خطوبة وجواز', 'مولود', 'تخرج', 'عيد الأم', 'فالنتين', 'رمضان والعيد'], filterable: true }] } }),
      n('gifts-men', 'هدايا رجالي', 'Gifts for Him'),
      n('gifts-women', 'هدايا حريمي', 'Gifts for Her'),
    ],
  }),

  n('appliances', 'أجهزة كهربائية', 'Home Appliances', {
    icon: 'plug',
    sortOrder: 10,
    storeTypes: [SHOWROOM, WAREHOUSE, SHOP],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, specs: [brandSpec(true), model, warranty, origin], units: ['قطعة'] },
    children: [
      n('appl-large', 'أجهزة كبيرة', 'Large Appliances', {
        children: [
          n('appl-fridges', 'ثلاجات', 'Refrigerators', { template: { size: { label: 'السعة', preset: 'fridge-feet', allowCustom: true }, specs: [{ key: 'nofrost', labelAr: 'نوفروست', type: 'boolean', filterable: true }] } }),
          n('appl-freezers', 'ديب فريزر', 'Freezers', { template: { size: { label: 'عدد الأدراج', values: ['4 درج', '5 درج', '6 درج', '7 درج'], allowCustom: true } } }),
          n('appl-washers', 'غسالات', 'Washing Machines', { template: { size: { label: 'السعة', preset: 'washer-kg', allowCustom: true }, specs: [{ key: 'washer_type', labelAr: 'النوع', type: 'select', options: ['فول أوتوماتيك', 'نص أوتوماتيك', 'تحميل علوي'], filterable: true }] } }),
          n('appl-dishwashers', 'غسالات أطباق', 'Dishwashers'),
          n('appl-cookers', 'بوتاجازات وأفران', 'Cookers & Ovens', { template: { size: { label: 'المقاس', values: ['4 شعلة 60 سم', '5 شعلة 90 سم', 'بلت إن'], allowCustom: true } } }),
          n('appl-ac', 'تكييفات', 'Air Conditioners', { template: { size: { label: 'القدرة', preset: 'ac-hp', allowCustom: true }, specs: [{ key: 'ac_type', labelAr: 'النوع', type: 'select', options: ['بارد فقط', 'بارد ساخن', 'إنفرتر'], filterable: true }] } }),
          n('appl-heaters', 'سخانات', 'Water Heaters', { template: { size: { label: 'السعة', values: ['30 لتر', '50 لتر', '80 لتر', '100 لتر', 'غاز 6 لتر', 'غاز 10 لتر'], allowCustom: true } } }),
        ],
      }),
      n('appl-small', 'أجهزة صغيرة', 'Small Appliances', {
        children: [
          n('appl-blenders', 'خلاطات ومحضرات طعام', 'Blenders & Food Processors'),
          n('appl-fryers', 'قلايات هوائية', 'Air Fryers', { template: { size: { label: 'السعة', values: ['3 لتر', '4 لتر', '5 لتر', '6 لتر', '8 لتر'], allowCustom: true } } }),
          n('appl-microwaves', 'ميكروويف', 'Microwaves'),
          n('appl-kettles', 'كاتل وماكينات قهوة', 'Kettles & Coffee Makers'),
          n('appl-irons', 'مكاوي', 'Irons'),
          n('appl-vacuums', 'مكانس كهربائية', 'Vacuum Cleaners'),
          n('appl-fans', 'مراوح ودفايات', 'Fans & Heaters'),
          n('appl-personal', 'أجهزة عناية شخصية', 'Personal Care Devices'),
        ],
      }),
      n('appl-tv', 'شاشات وتلفزيونات', 'TVs', { template: { size: { label: 'المقاس', preset: 'screen-inch', allowCustom: true }, specs: [{ key: 'smart', labelAr: 'سمارت', type: 'boolean', filterable: true }] } }),
    ],
  }),

  n('furniture', 'أثاث', 'Furniture', {
    icon: 'sofa',
    sortOrder: 11,
    storeTypes: [SHOWROOM],
    template: { ...noSize, color: { label: 'اللون/التشطيب', allowCustom: true }, specs: [woodMaterial, pieces, warranty], units: ['قطعة', 'طقم'] },
    children: [
      n('furn-bedrooms', 'غرف نوم', 'Bedrooms'),
      n('furn-living', 'أنتريهات وصالونات', 'Living Rooms'),
      n('furn-dining', 'سفرة', 'Dining Rooms'),
      n('furn-kitchens', 'مطابخ', 'Kitchens', { template: { size: { label: 'الطول', values: ['2 متر', '3 متر', '4 متر', '5 متر'], allowCustom: true } } }),
      n('furn-mattresses', 'مراتب', 'Mattresses', { template: { size: { label: 'المقاس', preset: 'bed', allowCustom: true }, specs: [{ key: 'height', labelAr: 'الارتفاع', type: 'number', unit: 'سم' }, brandSpec()] } }),
      n('furn-office', 'مكاتب وكراسي', 'Office Furniture'),
      n('furn-kids', 'أثاث أطفال', "Kids' Furniture"),
      n('furn-outdoor', 'أثاث خارجي', 'Outdoor Furniture'),
    ],
  }),

  n('electronics', 'موبايلات وإلكترونيات', 'Phones & Electronics', {
    icon: 'smartphone',
    sortOrder: 12,
    storeTypes: [SHOWROOM, SHOP],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, specs: [brandSpec(true), model, warranty], units: ['قطعة'] },
    children: [
      n('elec-phones', 'موبايلات', 'Mobile Phones', {
        template: {
          size: { label: 'المساحة', preset: 'phone-storage', allowCustom: true },
          specs: [deviceCondition, { key: 'ram', labelAr: 'الرامات', type: 'select', options: ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB'], filterable: true }, { key: 'sim', labelAr: 'الشرايح', type: 'select', options: ['شريحة واحدة', 'شريحتين', 'eSIM'] }],
        },
      }),
      n('elec-tablets', 'تابلت', 'Tablets', { template: { size: { label: 'المساحة', preset: 'phone-storage', allowCustom: true }, specs: [deviceCondition] } }),
      n('elec-laptops', 'لابتوب', 'Laptops', {
        template: {
          size: { label: 'الرامات / المساحة', preset: 'laptop-config', allowCustom: true },
          specs: [deviceCondition, { key: 'cpu', labelAr: 'البروسيسور', type: 'text' }, { key: 'screen', labelAr: 'الشاشة', type: 'number', unit: 'بوصة' }],
        },
      }),
      n('elec-audio', 'سماعات', 'Headphones & Speakers', { template: { specs: [{ key: 'connection', labelAr: 'التوصيل', type: 'select', options: ['بلوتوث', 'سلك', 'الاتنين'], filterable: true }] } }),
      n('elec-chargers', 'شواحن وكابلات وباور بانك', 'Chargers & Power Banks'),
      n('elec-cases', 'جرابات وحماية شاشة', 'Cases & Screen Protectors', { template: { size: { label: 'موديل الموبايل', allowCustom: true } } }),
      n('elec-wearables', 'ساعات ذكية', 'Smartwatches'),
      n('elec-gaming', 'ألعاب فيديو وبلايستيشن', 'Gaming', { template: { specs: [deviceCondition] } }),
      n('elec-cameras', 'كاميرات', 'Cameras', { template: { specs: [deviceCondition] } }),
    ],
  }),

  n('cars', 'سيارات وقطع غيار', 'Cars & Spare Parts', {
    icon: 'car',
    sortOrder: 13,
    storeTypes: [SHOWROOM],
    template: { ...noSize, ...noColor, specs: [brandSpec(true)], units: ['قطعة', 'طقم'] },
    children: [
      n('cars-cars', 'سيارات', 'Cars', {
        template: {
          color: { label: 'اللون', allowCustom: true },
          specs: [
            { key: 'model', labelAr: 'الموديل', type: 'text', required: true },
            { key: 'year', labelAr: 'سنة الصنع', type: 'number', required: true, filterable: true },
            { key: 'km', labelAr: 'العداد', type: 'number', unit: 'كم' },
            { key: 'transmission', labelAr: 'ناقل الحركة', type: 'select', options: ['أوتوماتيك', 'مانيوال'], required: true, filterable: true },
            { key: 'fuel', labelAr: 'الوقود', type: 'select', options: ['بنزين', 'سولار', 'غاز طبيعي', 'كهرباء', 'هايبرد'], filterable: true },
            { key: 'body', labelAr: 'الشكل', type: 'select', options: ['سيدان', 'هاتشباك', 'SUV / كروس أوفر', 'ميني فان', 'بيك أب'], filterable: true },
            { key: 'engine', labelAr: 'سعة الموتور', type: 'number', unit: 'سي سي' },
          ],
        },
      }),
      n('cars-motorcycles', 'موتوسيكلات وسكوتر', 'Motorcycles & Scooters', {
        template: { color: { label: 'اللون', allowCustom: true }, specs: [{ key: 'year', labelAr: 'سنة الصنع', type: 'number', filterable: true }, { key: 'engine', labelAr: 'سعة الموتور', type: 'number', unit: 'سي سي' }] },
      }),
      n('cars-parts', 'قطع غيار', 'Spare Parts', {
        template: { specs: [{ key: 'fits', labelAr: 'متوافقة مع', type: 'text', required: true }, { key: 'part_type', labelAr: 'النوع', type: 'select', options: ['أصلي', 'كوري', 'صيني', 'تايواني', 'تركي', 'استعمال'], filterable: true }] },
      }),
      n('cars-tires', 'كاوتش وجنوط', 'Tires & Rims', { template: { size: { label: 'المقاس', preset: 'tires', allowCustom: true } } }),
      n('cars-oils', 'زيوت وكيماويات', 'Oils & Fluids', { template: { size: { label: 'العبوة', preset: 'volume-l', allowCustom: true }, specs: [{ key: 'viscosity', labelAr: 'اللزوجة', type: 'text' }] } }),
      n('cars-accessories', 'إكسسوارات عربيات', 'Car Accessories', { template: { specs: [brandSpec(false)] } }),
    ],
  }),

  n('ceramics', 'سيراميك وأدوات صحية', 'Ceramics & Sanitary', {
    icon: 'bath',
    sortOrder: 14,
    storeTypes: [SHOWROOM, WAREHOUSE],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, specs: [brandSpec(true), origin, { key: 'grade', labelAr: 'الفرز', type: 'select', options: ['فرز أول', 'فرز تاني', 'فرز تالت'], filterable: true }], units: ['قطعة', 'طقم'] },
    children: [
      n('cer-tiles', 'سيراميك وبورسلين', 'Tiles & Porcelain', {
        template: {
          size: { label: 'المقاس', preset: 'tiles', allowCustom: true },
          color: { label: 'اللون/الموديل', allowCustom: true },
          units: ['متر مربع', 'كرتونة'],
          specs: [{ key: 'finish', labelAr: 'التشطيب', type: 'select', options: ['لامع', 'مط', 'ساتان', 'خشن (للأرضيات)'], filterable: true }, { key: 'm2_per_box', labelAr: 'متر في الكرتونة', type: 'number', unit: 'م²' }],
        },
      }),
      n('cer-bathroom-sets', 'أطقم حمامات', 'Bathroom Sets'),
      n('cer-faucets', 'خلاطات وحنفيات', 'Faucets & Mixers'),
      n('cer-sinks', 'أحواض ومغاسل', 'Sinks & Basins'),
      n('cer-showers', 'بانيوهات وكبائن شاور', 'Bathtubs & Showers'),
      n('cer-accessories', 'إكسسوارات حمامات', 'Bathroom Accessories'),
    ],
  }),

  n('home', 'ديكور ومفروشات', 'Decor & Furnishings', {
    icon: 'home',
    sortOrder: 15,
    storeTypes: [BRAND, SHOWROOM],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, units: ['قطعة', 'طقم'] },
    children: [
      n('home-bedding', 'ملايات وأطقم سرير', 'Bedding', { template: { size: { label: 'المقاس', preset: 'bed', allowCustom: true }, specs: [fabric, pieces] } }),
      n('home-blankets', 'بطاطين ولحف', 'Blankets & Quilts', { template: { size: { label: 'المقاس', preset: 'bed', allowCustom: true } } }),
      n('home-curtains', 'ستاير', 'Curtains', { template: { size: { label: 'المقاس', allowCustom: true }, units: ['متر', 'قطعة'] } }),
      n('home-rugs', 'سجاد وموكيت', 'Rugs & Carpets', { template: { size: { label: 'المقاس', values: ['80×150', '120×170', '160×230', '200×300', 'رانر 80×300'], allowCustom: true }, units: ['قطعة', 'متر مربع'] } }),
      n('home-lighting', 'إضاءة ونجف', 'Lighting'),
      n('home-wall', 'تابلوهات وديكور حوائط', 'Wall Decor'),
      n('home-vases', 'فازات ونباتات صناعية', 'Vases & Artificial Plants'),
      n('home-cushions', 'مخدات وكوشن', 'Cushions'),
      n('home-towels', 'فوط وبشاكير', 'Towels', { template: { size: { label: 'المقاس', values: ['وش 50×90', 'جسم 70×140', 'بشكير 90×160', 'طقم'], allowCustom: true } } }),
    ],
  }),

  n('groceries', 'مواد غذائية وبقالة', 'Groceries', {
    icon: 'shopping-basket',
    sortOrder: 20,
    storeTypes: [WAREHOUSE, SHOP],
    template: { size: { label: 'الوزن/الحجم', preset: 'weight-g', allowCustom: true }, ...noColor, specs: [brandSpec(), shelfLife, origin], units: ['قطعة', 'علبة', 'كرتونة', 'كيلو', 'شيكارة', 'باكو', 'شوال'] },
    children: [
      n('groc-rice-pasta', 'أرز ومكرونة وبقوليات', 'Rice, Pasta & Legumes'),
      n('groc-oils', 'زيوت وسمن', 'Oils & Ghee', { template: { size: { label: 'العبوة', preset: 'volume-l', allowCustom: true } } }),
      n('groc-sugar-tea', 'سكر وشاي وقهوة', 'Sugar, Tea & Coffee'),
      n('groc-dairy', 'ألبان وجبن', 'Dairy & Cheese'),
      n('groc-canned', 'معلبات', 'Canned Food'),
      n('groc-spices', 'صوصات وتوابل', 'Sauces & Spices'),
      n('groc-drinks', 'مشروبات وعصاير ومياه', 'Drinks & Water', { template: { size: { label: 'العبوة', preset: 'volume-l', allowCustom: true } } }),
      n('groc-snacks', 'سناكس وشيبسي', 'Snacks'),
      n('groc-biscuits', 'بسكويت وشوكولاتة', 'Biscuits & Chocolate'),
      n('groc-flour', 'دقيق ومخبوزات', 'Flour & Bakery'),
      n('groc-frozen', 'مجمدات', 'Frozen Food'),
      n('groc-baby', 'أكل أطفال', 'Baby Food'),
    ],
  }),

  n('housewares', 'أدوات منزلية', 'Housewares', {
    icon: 'cooking-pot',
    sortOrder: 21,
    storeTypes: [WAREHOUSE, SHOP],
    template: { size: { label: 'المقاس/الحجم', allowCustom: true }, color: { label: 'اللون', allowCustom: true }, specs: [kitchenMaterial, pieces, brandSpec()], units: PIECE },
    children: [
      n('hw-cookware', 'حلل وأواني طهي', 'Cookware', { template: { size: { label: 'المقاس', values: ['18 سم', '20 سم', '24 سم', '28 سم', '32 سم', 'طقم'], allowCustom: true } } }),
      n('hw-tableware', 'أطباق وكاسات وأدوات مائدة', 'Tableware & Glasses'),
      n('hw-storage', 'علب تخزين وبلاستيك', 'Storage & Plastics'),
      n('hw-kitchen-tools', 'أدوات مطبخ', 'Kitchen Tools'),
      n('hw-bathroom', 'منظمات وحمامات', 'Organizers'),
      n('hw-thermos', 'ترامس وزمزميات', 'Flasks & Bottles', { template: { size: { label: 'السعة', preset: 'volume-l', allowCustom: true } } }),
    ],
  }),

  n('building', 'مواد بناء', 'Building Materials', {
    icon: 'brick-wall',
    sortOrder: 22,
    storeTypes: [WAREHOUSE],
    template: { size: { label: 'المقاس', allowCustom: true }, ...noColor, specs: [brandSpec(true), origin], units: ['قطعة', 'شيكارة', 'طن', 'متر', 'متر مربع', 'متر مكعب', 'لفة'] },
    children: [
      n('build-cement', 'أسمنت وجبس', 'Cement & Gypsum', { template: { size: { label: 'العبوة', values: ['25 كجم', '50 كجم', 'سايب'], allowCustom: true }, units: ['شيكارة', 'طن'] } }),
      n('build-steel', 'حديد تسليح', 'Rebar', { template: { size: { label: 'القطر', values: ['6 مم', '8 مم', '10 مم', '12 مم', '16 مم', '18 مم', '22 مم', '25 مم'], allowCustom: false }, units: ['طن'] } }),
      n('build-bricks', 'طوب وبلوك', 'Bricks & Blocks', { template: { units: ['ألف طوبة', 'قطعة'] } }),
      n('build-sand', 'رمل وزلط', 'Sand & Gravel', { template: { ...noSize, units: ['متر مكعب', 'نقلة'] } }),
      n('build-paints', 'دهانات', 'Paints', { template: { size: { label: 'العبوة', preset: 'volume-l', allowCustom: true }, color: { label: 'اللون', allowCustom: true }, units: ['جالون', 'بستلة', 'قطعة'] } }),
      n('build-insulation', 'عزل', 'Insulation', { template: { units: ['لفة', 'متر مربع', 'بستلة'] } }),
      n('build-electric', 'كهرباء وكابلات', 'Electrical & Cables', { template: { size: { label: 'المقطع', values: ['1.5 مم', '2 مم', '3 مم', '4 مم', '6 مم', '10 مم'], allowCustom: true }, units: ['لفة', 'متر', 'قطعة'] } }),
      n('build-plumbing', 'سباكة ومواسير', 'Plumbing', { template: { size: { label: 'القطر', values: ['1/2 بوصة', '3/4 بوصة', '1 بوصة', '2 بوصة', '3 بوصة', '4 بوصة'], allowCustom: true }, units: ['قطعة', 'ماسورة', 'متر'] } }),
      n('build-tools', 'عدد وأدوات', 'Tools'),
    ],
  }),

  n('cleaning', 'منظفات', 'Cleaning Supplies', {
    icon: 'spray-can',
    sortOrder: 23,
    storeTypes: [WAREHOUSE, SHOP],
    template: { size: { label: 'العبوة', values: ['500 مل', '1 لتر', '2 لتر', '3 لتر', '500 جم', '1 كجم', '2.5 كجم', '5 كجم'], allowCustom: true }, ...noColor, specs: [brandSpec()], units: PACKED },
    children: [
      n('clean-laundry', 'منظفات غسيل', 'Laundry'),
      n('clean-dishes', 'سائل أطباق', 'Dishwashing'),
      n('clean-floors', 'منظفات أرضيات وأسطح', 'Floor & Surface Cleaners'),
      n('clean-disinfect', 'مطهرات', 'Disinfectants'),
      n('clean-paper', 'مناديل وورقيات', 'Tissues & Paper', { template: { size: { label: 'العبوة', values: ['باكو', '6 رول', '12 رول', '24 رول'], allowCustom: true } } }),
      n('clean-tools', 'أدوات تنظيف', 'Cleaning Tools', { template: { ...noSize, color: { label: 'اللون', allowCustom: true } } }),
      n('clean-personal', 'صابون وشامبو', 'Soap & Shampoo'),
    ],
  }),

  n('wholesale-clothing', 'ملابس بالجملة', 'Wholesale Clothing', {
    icon: 'shirt',
    sortOrder: 24,
    storeTypes: [WAREHOUSE],
    template: apparel,
    children: clothingChildren('wholesale'),
  }),

  n('office', 'كتب وأدوات مكتبية', 'Books & Office Supplies', {
    icon: 'book-open',
    sortOrder: 25,
    storeTypes: [WAREHOUSE, SHOP],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, specs: [brandSpec()], units: PACKED },
    children: [
      n('office-books', 'كتب وروايات', 'Books', { template: { ...noColor, specs: [{ key: 'author', labelAr: 'المؤلف', type: 'text' }, { key: 'publisher', labelAr: 'دار النشر', type: 'text' }] } }),
      n('office-school-books', 'كتب خارجية ودراسية', 'School Books', { template: { ...noColor, specs: [{ key: 'grade', labelAr: 'السنة الدراسية', type: 'text', filterable: true }] } }),
      n('office-notebooks', 'كشاكيل وكراسات', 'Notebooks', { template: { size: { label: 'عدد الورق', values: ['40 ورقة', '60 ورقة', '80 ورقة', '100 ورقة', '200 ورقة'], allowCustom: true } } }),
      n('office-pens', 'أقلام وأدوات كتابة', 'Pens & Writing'),
      n('office-art', 'أدوات رسم وهندسة', 'Art & Drawing'),
      n('office-bags', 'شنط مدرسة', 'School Bags'),
      n('office-paper', 'ورق تصوير وطباعة', 'Printing Paper', { template: { size: { label: 'المقاس', values: ['A4', 'A3', 'A5'], allowCustom: true }, ...noColor, units: ['رزمة', 'كرتونة'] } }),
      n('office-supplies', 'مستلزمات مكاتب', 'Office Supplies'),
    ],
  }),

  n('pharmacy', 'صيدلية وعناية', 'Pharmacy & Care', {
    icon: 'pill',
    sortOrder: 30,
    storeTypes: [SHOP],
    template: { size: { label: 'الحجم', allowCustom: true }, ...noColor, specs: [brandSpec(), shelfLife], units: ['قطعة', 'علبة', 'شريط'] },
    children: [
      n('pharm-skin', 'عناية بالبشرة', 'Skincare'),
      n('pharm-baby', 'عناية بالأطفال وحفاضات', 'Baby Care', { template: { size: { label: 'المقاس', preset: 'diaper-size', allowCustom: true } } }),
      n('pharm-vitamins', 'فيتامينات ومكملات', 'Vitamins & Supplements'),
      n('pharm-devices', 'أجهزة طبية', 'Medical Devices', { template: { ...noSize, specs: [warranty] } }),
      n('pharm-first-aid', 'إسعافات أولية', 'First Aid'),
      n('pharm-personal', 'عناية شخصية', 'Personal Care'),
    ],
  }),

  n('toys', 'ألعاب', 'Toys', {
    icon: 'puzzle',
    sortOrder: 31,
    storeTypes: [SHOP],
    template: { ...noSize, color: { label: 'اللون', allowCustom: true }, specs: [toyAge, brandSpec()], units: ['قطعة', 'علبة', 'طقم'] },
    children: [
      n('toys-educational', 'ألعاب تعليمية', 'Educational Toys'),
      n('toys-dolls', 'عرايس ودباديب', 'Dolls & Plush'),
      n('toys-cars', 'عربيات وريموت كنترول', 'Cars & RC'),
      n('toys-building', 'مكعبات وتركيب', 'Building Sets'),
      n('toys-outdoor', 'عجل وألعاب خارجية', 'Bikes & Outdoor', { template: { size: { label: 'المقاس', values: ['12 بوصة', '16 بوصة', '20 بوصة', '24 بوصة', '26 بوصة'], allowCustom: true } } }),
      n('toys-baby', 'ألعاب بيبي', 'Baby Toys'),
      n('toys-board', 'ألعاب جماعية وبازل', 'Board Games & Puzzles'),
    ],
  }),

  n('other', 'أخرى', 'Other', { icon: 'grid', sortOrder: 99, storeTypes: [] }),
];

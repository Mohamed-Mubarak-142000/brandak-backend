import { StoreType } from '@/common/enums';

/** Draft pricing from the business analysis — editable later from the admin dashboard. */
export const PLANS = [
  {
    code: 'FREE',
    nameAr: 'مجانية',
    nameEn: 'Free',
    descriptionAr: 'ابدأ من غير ما تدفع حاجة، وطوّر لما الطلبات تزيد.',
    priceMonthly: 0,
    priceYearly: 0,
    limits: { maxActiveProducts: 10, maxOrdersPerMonth: 30, maxImagesPerProduct: 3 },
    features: ['حتى 10 منتجات منشورة', 'حتى 30 طلب في الشهر', '3 صور لكل منتج', 'صفحة متجر وإدارة الطلبات'],
    sortOrder: 0,
  },
  {
    code: 'STARTER',
    nameAr: 'البداية',
    nameEn: 'Starter',
    descriptionAr: 'مناسبة للبراند الجديد اللي بيجرب البيع أونلاين.',
    priceMonthly: 99,
    priceYearly: 990,
    limits: { maxActiveProducts: 30, maxOrdersPerMonth: 300, maxImagesPerProduct: 6 },
    features: ['حتى 30 منتجًا منشورًا', 'حتى 300 طلب في الشهر', '6 صور لكل منتج', 'إدارة الطلبات وحالاتها', 'صفحة براند وبيانات تواصل', 'إعدادات الشحن الأساسية', 'إحصائيات أساسية'],
    sortOrder: 1,
  },
  {
    code: 'GROWTH',
    nameAr: 'النمو',
    nameEn: 'Growth',
    descriptionAr: 'للبراند اللي بدأ يستقبل طلبات بشكل مستمر.',
    priceMonthly: 199,
    priceYearly: 1990,
    limits: { maxActiveProducts: 200, maxOrdersPerMonth: 2000, maxImagesPerProduct: 10 },
    features: ['حتى 200 منتج منشور', 'حتى 2000 طلب في الشهر', '10 صور لكل منتج', 'كل مزايا البداية', 'المقاسات والألوان والمخزون', 'تقارير مبيعات أكثر تفصيلًا'],
    sortOrder: 2,
  },
  {
    code: 'PRO',
    nameAr: 'المحترف',
    nameEn: 'Pro',
    descriptionAr: 'للبراند اللي عنده كتالوج كبير واحتياجات متقدمة.',
    priceMonthly: 349,
    priceYearly: 3490,
    limits: { maxActiveProducts: 1000, maxOrdersPerMonth: null, maxImagesPerProduct: 10 },
    features: ['حتى 1000 منتج منشور', 'طلبات بلا حد', 'كل مزايا النمو', 'دعم فني بأولوية أعلى'],
    sortOrder: 3,
  },
];

const { BRAND, SHOWROOM, WAREHOUSE, SHOP } = StoreType;

/**
 * Categories and the store types they are offered to when opening a store. Shared categories
 * (e.g. appliances) list several types; an empty list means every type.
 */
export const CATEGORIES: { slug: string; nameAr: string; nameEn: string; icon: string; sortOrder: number; storeTypes: StoreType[] }[] = [
  { slug: 'fashion', nameAr: 'ملابس', nameEn: 'Fashion', icon: 'shirt', sortOrder: 1, storeTypes: [BRAND, SHOWROOM, SHOP] },
  { slug: 'shoes-bags', nameAr: 'أحذية وشنط', nameEn: 'Shoes & Bags', icon: 'footprints', sortOrder: 2, storeTypes: [BRAND, SHOP] },
  { slug: 'accessories', nameAr: 'إكسسوارات', nameEn: 'Accessories', icon: 'watch', sortOrder: 3, storeTypes: [BRAND, SHOP] },
  { slug: 'beauty', nameAr: 'عناية وجمال', nameEn: 'Beauty & Care', icon: 'sparkles', sortOrder: 4, storeTypes: [BRAND] },
  { slug: 'handmade', nameAr: 'هاند ميد', nameEn: 'Handmade', icon: 'hand', sortOrder: 5, storeTypes: [BRAND] },
  { slug: 'kids', nameAr: 'أطفال', nameEn: 'Kids', icon: 'baby', sortOrder: 6, storeTypes: [BRAND] },
  { slug: 'food', nameAr: 'أكل وحلويات', nameEn: 'Food & Sweets', icon: 'cake', sortOrder: 7, storeTypes: [BRAND] },
  { slug: 'gifts', nameAr: 'هدايا', nameEn: 'Gifts', icon: 'gift', sortOrder: 8, storeTypes: [BRAND] },
  { slug: 'appliances', nameAr: 'أجهزة كهربائية', nameEn: 'Home Appliances', icon: 'plug', sortOrder: 10, storeTypes: [SHOWROOM, WAREHOUSE, SHOP] },
  { slug: 'furniture', nameAr: 'أثاث', nameEn: 'Furniture', icon: 'sofa', sortOrder: 11, storeTypes: [SHOWROOM] },
  { slug: 'electronics', nameAr: 'موبايلات وإلكترونيات', nameEn: 'Phones & Electronics', icon: 'smartphone', sortOrder: 12, storeTypes: [SHOWROOM, SHOP] },
  { slug: 'cars', nameAr: 'سيارات وقطع غيار', nameEn: 'Cars & Spare Parts', icon: 'car', sortOrder: 13, storeTypes: [SHOWROOM] },
  { slug: 'ceramics', nameAr: 'سيراميك وأدوات صحية', nameEn: 'Ceramics & Sanitary', icon: 'bath', sortOrder: 14, storeTypes: [SHOWROOM, WAREHOUSE] },
  { slug: 'home', nameAr: 'ديكور ومفروشات', nameEn: 'Decor & Furnishings', icon: 'home', sortOrder: 15, storeTypes: [BRAND, SHOWROOM] },
  { slug: 'groceries', nameAr: 'مواد غذائية وبقالة', nameEn: 'Groceries', icon: 'shopping-basket', sortOrder: 20, storeTypes: [WAREHOUSE, SHOP] },
  { slug: 'housewares', nameAr: 'أدوات منزلية', nameEn: 'Housewares', icon: 'cooking-pot', sortOrder: 21, storeTypes: [WAREHOUSE, SHOP] },
  { slug: 'building', nameAr: 'مواد بناء', nameEn: 'Building Materials', icon: 'brick-wall', sortOrder: 22, storeTypes: [WAREHOUSE] },
  { slug: 'cleaning', nameAr: 'منظفات', nameEn: 'Cleaning Supplies', icon: 'spray-can', sortOrder: 23, storeTypes: [WAREHOUSE, SHOP] },
  { slug: 'wholesale-clothing', nameAr: 'ملابس بالجملة', nameEn: 'Wholesale Clothing', icon: 'shirt', sortOrder: 24, storeTypes: [WAREHOUSE] },
  { slug: 'office', nameAr: 'كتب وأدوات مكتبية', nameEn: 'Books & Office Supplies', icon: 'book-open', sortOrder: 25, storeTypes: [WAREHOUSE, SHOP] },
  { slug: 'pharmacy', nameAr: 'صيدلية وعناية', nameEn: 'Pharmacy & Care', icon: 'pill', sortOrder: 30, storeTypes: [SHOP] },
  { slug: 'toys', nameAr: 'ألعاب', nameEn: 'Toys', icon: 'puzzle', sortOrder: 31, storeTypes: [SHOP] },
  { slug: 'other', nameAr: 'أخرى', nameEn: 'Other', icon: 'grid', sortOrder: 99, storeTypes: [] },
];

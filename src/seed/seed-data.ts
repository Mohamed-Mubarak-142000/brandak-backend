/** Draft pricing from the business analysis — editable later from the admin dashboard. */
export const PLANS = [
  {
    code: 'STARTER',
    nameAr: 'البداية',
    nameEn: 'Starter',
    descriptionAr: 'مناسبة للبراند الجديد اللي بيجرب البيع أونلاين.',
    priceMonthly: 99,
    priceYearly: 990,
    limits: { maxActiveProducts: 30 },
    features: ['حتى 30 منتجًا منشورًا', 'إدارة الطلبات وحالاتها', 'صفحة براند وبيانات تواصل', 'إعدادات الشحن الأساسية', 'إحصائيات أساسية'],
    sortOrder: 1,
  },
  {
    code: 'GROWTH',
    nameAr: 'النمو',
    nameEn: 'Growth',
    descriptionAr: 'للبراند اللي بدأ يستقبل طلبات بشكل مستمر.',
    priceMonthly: 199,
    priceYearly: 1990,
    limits: { maxActiveProducts: 200 },
    features: ['حتى 200 منتج منشور', 'كل مزايا البداية', 'المقاسات والألوان والمخزون', 'تقارير مبيعات أكثر تفصيلًا'],
    sortOrder: 2,
  },
  {
    code: 'PRO',
    nameAr: 'المحترف',
    nameEn: 'Pro',
    descriptionAr: 'للبراند اللي عنده كتالوج كبير واحتياجات متقدمة.',
    priceMonthly: 349,
    priceYearly: 3490,
    limits: { maxActiveProducts: 1000 },
    features: ['حتى 1000 منتج منشور', 'كل مزايا النمو', 'دعم فني بأولوية أعلى'],
    sortOrder: 3,
  },
];

export const CATEGORIES = [
  { slug: 'fashion', nameAr: 'ملابس', nameEn: 'Fashion', icon: 'shirt', sortOrder: 1 },
  { slug: 'accessories', nameAr: 'إكسسوارات', nameEn: 'Accessories', icon: 'watch', sortOrder: 2 },
  { slug: 'beauty', nameAr: 'عناية وجمال', nameEn: 'Beauty & Care', icon: 'sparkles', sortOrder: 3 },
  { slug: 'handmade', nameAr: 'هاند ميد', nameEn: 'Handmade', icon: 'hand', sortOrder: 4 },
  { slug: 'gifts', nameAr: 'هدايا', nameEn: 'Gifts', icon: 'gift', sortOrder: 5 },
  { slug: 'home', nameAr: 'ديكور ومنزل', nameEn: 'Home & Decor', icon: 'home', sortOrder: 6 },
  { slug: 'food', nameAr: 'أكل وحلويات', nameEn: 'Food & Sweets', icon: 'cake', sortOrder: 7 },
  { slug: 'kids', nameAr: 'أطفال', nameEn: 'Kids', icon: 'baby', sortOrder: 8 },
  { slug: 'other', nameAr: 'أخرى', nameEn: 'Other', icon: 'grid', sortOrder: 99 },
];

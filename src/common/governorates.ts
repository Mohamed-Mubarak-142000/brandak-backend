/** Egypt's 27 governorates. Codes are stored; names are for display. */
export const GOVERNORATES = [
  { code: 'CAI', ar: 'القاهرة', en: 'Cairo' },
  { code: 'GIZ', ar: 'الجيزة', en: 'Giza' },
  { code: 'ALX', ar: 'الإسكندرية', en: 'Alexandria' },
  { code: 'QLB', ar: 'القليوبية', en: 'Qalyubia' },
  { code: 'DK', ar: 'الدقهلية', en: 'Dakahlia' },
  { code: 'SHR', ar: 'الشرقية', en: 'Sharqia' },
  { code: 'GH', ar: 'الغربية', en: 'Gharbia' },
  { code: 'MNF', ar: 'المنوفية', en: 'Monufia' },
  { code: 'BH', ar: 'البحيرة', en: 'Beheira' },
  { code: 'KFS', ar: 'كفر الشيخ', en: 'Kafr El Sheikh' },
  { code: 'DT', ar: 'دمياط', en: 'Damietta' },
  { code: 'PTS', ar: 'بورسعيد', en: 'Port Said' },
  { code: 'IS', ar: 'الإسماعيلية', en: 'Ismailia' },
  { code: 'SUZ', ar: 'السويس', en: 'Suez' },
  { code: 'FYM', ar: 'الفيوم', en: 'Faiyum' },
  { code: 'BNS', ar: 'بني سويف', en: 'Beni Suef' },
  { code: 'MN', ar: 'المنيا', en: 'Minya' },
  { code: 'AST', ar: 'أسيوط', en: 'Asyut' },
  { code: 'SHG', ar: 'سوهاج', en: 'Sohag' },
  { code: 'KN', ar: 'قنا', en: 'Qena' },
  { code: 'LX', ar: 'الأقصر', en: 'Luxor' },
  { code: 'ASN', ar: 'أسوان', en: 'Aswan' },
  { code: 'BA', ar: 'البحر الأحمر', en: 'Red Sea' },
  { code: 'WAD', ar: 'الوادي الجديد', en: 'New Valley' },
  { code: 'MT', ar: 'مطروح', en: 'Matrouh' },
  { code: 'SIN', ar: 'شمال سيناء', en: 'North Sinai' },
  { code: 'JS', ar: 'جنوب سيناء', en: 'South Sinai' },
] as const;

export type GovernorateCode = (typeof GOVERNORATES)[number]['code'];
export const GOVERNORATE_CODES = GOVERNORATES.map((g) => g.code) as GovernorateCode[];

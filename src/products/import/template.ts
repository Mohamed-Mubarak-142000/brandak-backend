import ExcelJS from 'exceljs';
import { COLUMNS } from './sheet';

const BRAND = 'FFF16B21';
const SOFT = 'FFFFEADB';

/** The import template: a products sheet with examples, the category names, and instructions. */
export async function buildTemplate(categories: { nameAr: string; parent?: string }[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'Fatrina';

  const sheet = book.addWorksheet('المنتجات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.id, width: c.width }));
  const head = sheet.getRow(1);
  head.height = 28;
  head.eachCell((cell, i) => {
    const required = COLUMNS[i - 1].header.includes('*');
    cell.font = { bold: true, color: { argb: required ? 'FFFFFFFF' : 'FF2A1D14' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? BRAND : SOFT } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.note = COLUMNS[i - 1].note;
  });

  const cat = categories[0]?.nameAr ?? '';
  const examples = [
    { title: 'تيشيرت قطن أوفرسايز', price: 350, compareAtPrice: 450, size: 'M', color: 'أسود', stock: 10, category: cat, description: 'قطن 100%، مريح للبس اليومي', tags: 'صيفي، قطن، أوفرسايز', images: 'https://example.com/tshirt-1.jpg, https://example.com/tshirt-2.jpg' },
    { title: 'تيشيرت قطن أوفرسايز', size: 'L', color: 'أسود', stock: 8 },
    { title: 'تيشيرت قطن أوفرسايز', size: 'L', color: 'أبيض', stock: 5, variantPrice: 370 },
    { title: 'شنطة كروس جلد', price: 600, stock: 12, category: cat, description: 'جلد طبيعي بأكتر من جيب', images: 'https://example.com/bag.jpg' },
  ];
  examples.forEach((e) => sheet.addRow(e));
  // Example rows in grey so sellers know to replace them.
  for (let r = 2; r <= examples.length + 1; r++) sheet.getRow(r).font = { color: { argb: 'FF7A6656' }, italic: true };

  // Category column: dropdown from the categories sheet.
  const cats = book.addWorksheet('الأقسام', { views: [{ rightToLeft: true }] });
  cats.columns = [
    { header: 'القسم', key: 'nameAr', width: 28 },
    { header: 'تابع لـ', key: 'parent', width: 24 },
  ];
  cats.getRow(1).font = { bold: true };
  categories.forEach((c) => cats.addRow(c));
  const catCol = COLUMNS.findIndex((c) => c.id === 'category') + 1;
  const letter = sheet.getColumn(catCol).letter;
  if (categories.length) {
    for (let r = 2; r <= 501; r++) {
      sheet.getCell(`${letter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'الأقسام'!$A$2:$A$${categories.length + 1}`],
        showErrorMessage: false,
      };
    }
  }

  const help = book.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
  help.columns = [{ width: 110 }];
  [
    'إزاي تملا الملف',
    '1. كل صف = مقاس أو لون من منتج. لو المنتج مقاس واحد، صف واحد كفاية.',
    '2. الصفوف اللي ليها نفس "اسم المنتج" بتبقى منتج واحد بكل مقاساته وألوانه. السعر والوصف والقسم والصور بيتاخدوا من أول صف.',
    '3. الأعمدة البرتقالي (عليها *) لازم تتملا: اسم المنتج، السعر، المخزون.',
    '4. القسم: اختاره من القائمة أو اكتبه زي شيت "الأقسام". لو متجرك ليه قسم واحد سيبه فاضي.',
    '5. الصور: حط روابط مباشرة للصور (تبدأ بـ https وتفتح الصورة نفسها)، وافصل بينها بفاصلة. صور كل لون حطها في صف اللون ده، عشان العميل لما يختار اللون يشوف صوره. عدد الصور حسب باقتك.',
    '6. امسح صفوف الأمثلة الرمادي قبل الرفع.',
    '7. لحد 500 صف في الملف الواحد. احفظه .xlsx أو .csv.',
    '8. المنتجات اللي اسمها موجود بالفعل في متجرك هتتخطى، عشان متتكررش لو رفعت الملف مرتين.',
    '9. المنتج من غير صور بيتحفظ مسودة، وتقدر تضيفله صور وتنشره من التطبيق.',
  ].forEach((line, i) => {
    const row = help.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 14, color: { argb: BRAND } };
  });

  return Buffer.from(await book.xlsx.writeBuffer());
}

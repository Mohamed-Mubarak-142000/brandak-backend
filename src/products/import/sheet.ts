import ExcelJS from 'exceljs';
import { AppError } from '@/common/errors';

/** One spreadsheet row, keyed by our column ids. `line` is the row number the seller sees. */
export interface SheetRow {
  line: number;
  values: Partial<Record<ColumnId, string>>;
}

export type ColumnId =
  | 'title'
  | 'description'
  | 'category'
  | 'price'
  | 'compareAtPrice'
  | 'size'
  | 'color'
  | 'stock'
  | 'variantPrice'
  | 'sku'
  | 'tags'
  | 'images';

/** The template's headers, in order. `*` marks required columns. */
export const COLUMNS: { id: ColumnId; header: string; aliases: string[]; width: number; note: string }[] = [
  { id: 'title', header: 'اسم المنتج *', aliases: ['اسم المنتج', 'الاسم', 'المنتج', 'title', 'name', 'product'], width: 32, note: 'الصفوف اللي ليها نفس الاسم بتبقى منتج واحد بمقاسات وألوان مختلفة' },
  { id: 'price', header: 'السعر *', aliases: ['السعر', 'price'], width: 12, note: 'بالجنيه، رقم بس' },
  { id: 'compareAtPrice', header: 'السعر قبل الخصم', aliases: ['السعر قبل الخصم', 'compare at price', 'compare_at_price', 'old price'], width: 16, note: 'لازم يكون أكبر من السعر' },
  { id: 'size', header: 'المقاس', aliases: ['المقاس', 'size'], width: 10, note: 'سيبه فاضي لو مقاس واحد' },
  { id: 'color', header: 'اللون', aliases: ['اللون', 'color', 'colour'], width: 12, note: 'مثال: أسود' },
  { id: 'stock', header: 'المخزون *', aliases: ['المخزون', 'الكمية', 'stock', 'quantity', 'qty'], width: 10, note: 'عدد القطع المتاحة' },
  { id: 'variantPrice', header: 'سعر مختلف للمقاس', aliases: ['سعر مختلف للمقاس', 'سعر مختلف', 'variant price', 'variant_price'], width: 16, note: 'لو المقاس ده سعره مختلف' },
  { id: 'category', header: 'القسم', aliases: ['القسم', 'category'], width: 16, note: 'زي ما مكتوب في شيت الأقسام. فاضي = قسم متجرك لو ليه قسم واحد' },
  { id: 'description', header: 'الوصف', aliases: ['الوصف', 'description'], width: 40, note: 'الخامة، المقاسات، طريقة الغسيل' },
  { id: 'tags', header: 'كلمات مفتاحية', aliases: ['كلمات مفتاحية', 'الكلمات المفتاحية', 'tags'], width: 24, note: 'افصل بينها بفاصلة' },
  { id: 'images', header: 'روابط الصور', aliases: ['روابط الصور', 'الصور', 'صور', 'images', 'image urls', 'image_urls'], width: 40, note: 'روابط مباشرة لصور (https)، افصل بينها بفاصلة. لحد 10 صور' },
  { id: 'sku', header: 'SKU', aliases: ['sku', 'كود', 'الكود'], width: 14, note: 'كود داخلي اختياري' },
];

export const MAX_IMPORT_ROWS = 500;

const normalizeHeader = (s: string) =>
  s.replace(/\*/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();

const HEADER_MAP = new Map<string, ColumnId>(
  COLUMNS.flatMap((c) => [c.header, ...c.aliases].map((h) => [normalizeHeader(h), c.id] as const)),
);

/** Reads the first sheet of an .xlsx or a .csv file into rows. */
export async function readSheet(buffer: Buffer, filename: string): Promise<SheetRow[]> {
  const ext = filename.toLowerCase().split('.').pop();
  const grid = ext === 'csv' || looksLikeText(buffer) ? parseCsv(buffer.toString('utf8').replace(/^\u{FEFF}/u, '')) : await readXlsx(buffer);

  const headerIndex = grid.findIndex((r) => r.some((c) => HEADER_MAP.has(normalizeHeader(c))));
  if (headerIndex < 0) {
    throw AppError.unprocessable('IMPORT_NO_HEADERS', 'Could not find the column headers. Use the template file.');
  }
  const columns = grid[headerIndex].map((h) => HEADER_MAP.get(normalizeHeader(h)));
  if (!columns.includes('title') || !columns.includes('price') || !columns.includes('stock')) {
    throw AppError.unprocessable('IMPORT_MISSING_COLUMNS', 'The file needs the name, price and stock columns');
  }

  const rows: SheetRow[] = [];
  grid.slice(headerIndex + 1).forEach((cells, i) => {
    const values: SheetRow['values'] = {};
    cells.forEach((cell, c) => {
      const id = columns[c];
      const v = cell.trim();
      if (id && v) values[id] = v;
    });
    if (Object.keys(values).length) rows.push({ line: headerIndex + i + 2, values });
  });
  if (!rows.length) throw AppError.unprocessable('IMPORT_EMPTY', 'The file has no product rows');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw AppError.unprocessable('IMPORT_TOO_MANY_ROWS', `Up to ${MAX_IMPORT_ROWS} rows per file`);
  }
  return rows;
}

async function readXlsx(buffer: Buffer): Promise<string[][]> {
  const book = new ExcelJS.Workbook();
  try {
    // exceljs' typings predate Node's generic Buffer.
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw AppError.unprocessable('IMPORT_BAD_FILE', 'Could not read the file. Save it as .xlsx or .csv');
  }
  const sheet = book.worksheets.find((w) => w.state === 'visible') ?? book.worksheets[0];
  if (!sheet) throw AppError.unprocessable('IMPORT_EMPTY', 'The file has no sheets');
  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cells[c - 1] = cellText(cell.value);
    });
    grid[n - 1] = Array.from(cells, (c) => c ?? '');
  });
  return Array.from(grid, (r) => r ?? []);
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink;
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result == null ? '' : String(v.result); // formula
    return '';
  }
  return String(v);
}

function looksLikeText(buffer: Buffer) {
  // .xlsx is a zip ("PK"); anything else we try as CSV.
  return !(buffer[0] === 0x50 && buffer[1] === 0x4b);
}

/** RFC 4180 CSV with quoted fields; also accepts ";" or tab as the separator (Excel in some locales). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t', '،'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

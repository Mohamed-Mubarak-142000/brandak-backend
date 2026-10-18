import { parseCsv, readSheet } from './sheet';
import { buildTemplate } from './template';

describe('product import sheet', () => {
  it('parses quoted CSV fields, commas inside quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('detects semicolon-separated CSV', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('maps Arabic and English headers and skips empty rows', async () => {
    const csv = '﻿اسم المنتج *,السعر,Stock,اللون\nتيشيرت,٣٥٠,10,أسود\n,,,\nتيشيرت,,5,أبيض\n';
    const rows = await readSheet(Buffer.from(csv), 'p.csv');
    expect(rows).toEqual([
      { line: 2, values: { title: 'تيشيرت', price: '٣٥٠', stock: '10', color: 'أسود' } },
      { line: 4, values: { title: 'تيشيرت', stock: '5', color: 'أبيض' } },
    ]);
  });

  it('refuses a file without the required columns', async () => {
    await expect(readSheet(Buffer.from('اسم المنتج,اللون\nx,y'), 'p.csv')).rejects.toMatchObject({ code: 'IMPORT_MISSING_COLUMNS' });
  });

  it('reads back its own template', async () => {
    const file = await buildTemplate([{ nameAr: 'ملابس' }]);
    const rows = await readSheet(file, 'template.xlsx');
    expect(rows).toHaveLength(4);
    expect(rows[0].values).toMatchObject({ title: 'تيشيرت قطن أوفرسايز', price: '350', stock: '10', category: 'ملابس' });
    expect(rows[2].values).toMatchObject({ size: 'L', color: 'أبيض', variantPrice: '370' });
  });
});

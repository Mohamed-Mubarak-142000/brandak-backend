import {
  normalizeEgyptPhone,
  normalizeReference,
  normalizeSearchText,
  slugify,
} from './text';

describe('text utils', () => {
  it('normalizes Arabic letter variants and diacritics', () => {
    expect(normalizeSearchText('أَحْمَد')).toBe('احمد');
    expect(normalizeSearchText('إكسسوارات  هاند  ميد')).toBe('اكسسوارات هاند ميد');
    expect(normalizeSearchText('مكتبة')).toBe(normalizeSearchText('مكتبه'));
    expect(normalizeSearchText('مستشفى')).toBe('مستشفي');
    expect(normalizeSearchText('Noura HANDMADE')).toBe('noura handmade');
  });

  it('builds slugs that keep Arabic letters', () => {
    expect(slugify('Noura Handmade!')).toBe('noura-handmade');
    expect(slugify('براند نورا')).toBe('براند-نورا');
  });

  it('normalizes Egyptian mobile numbers', () => {
    expect(normalizeEgyptPhone('01050867135')).toBe('+201050867135');
    expect(normalizeEgyptPhone('+20 105 086 7135')).toBe('+201050867135');
    expect(normalizeEgyptPhone('201050867135')).toBe('+201050867135');
    expect(normalizeEgyptPhone('0135')).toBeNull();
    expect(normalizeEgyptPhone('01350867135')).toBeNull();
  });

  it('normalizes transfer references', () => {
    expect(normalizeReference(' ab-12 34_x ')).toBe('AB1234X');
  });
});

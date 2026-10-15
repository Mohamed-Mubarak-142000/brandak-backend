const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

/**
 * Normalizes Arabic/Latin text for search: strips tashkeel and tatweel, unifies alef/yaa/taa-marbuta
 * forms, lowercases Latin and collapses whitespace. Apply the same function to stored text and queries.
 */
export function normalizeSearchText(input: string): string {
  return input
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** URL slug that keeps Arabic letters (store slugs are shown to Arabic users). */
export function slugify(input: string): string {
  return normalizeSearchText(input)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Normalizes an Egyptian mobile number to E.164 (+201XXXXXXXXX). Returns null when invalid. */
export function normalizeEgyptPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '');
  let national: string;
  if (digits.startsWith('20')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  return /^1[0125]\d{8}$/.test(national) ? `+20${national}` : null;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Transfer references are compared without spaces, dashes or case so the same transfer can't be reused. */
export function normalizeReference(input: string): string {
  return input.replace(/[\s\-_]/g, '').toUpperCase();
}

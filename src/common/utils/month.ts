/** First moment of the current month in Cairo (UTC+2; an hour off during summer time is fine here). */
export function cairoMonthStart(now = new Date()) {
  const cairo = new Date(now.getTime() + 2 * 3_600_000);
  return new Date(Date.UTC(cairo.getUTCFullYear(), cairo.getUTCMonth(), 1) - 2 * 3_600_000);
}

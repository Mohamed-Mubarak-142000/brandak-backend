import { FilterQuery, Model } from 'mongoose';

/** The calendar day in Cairo (UTC+2), e.g. "2026-11-04". */
export const cairoDay = (d = new Date()) => new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);

const isDuplicate = (e: unknown) => (e as { code?: number })?.code === 11000;

/**
 * Takes one unit of a daily quota atomically: `filter` must match a unique index (e.g. brandId + day).
 * Returns false when the quota is used up. Parallel requests can't pass the limit.
 */
export async function takeDaily<T extends { count: number }>(model: Model<T>, filter: FilterQuery<T>, limit: number): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // When the row is at the limit the filter misses and the upsert hits the unique index.
      await model.updateOne({ ...filter, count: { $lt: limit } } as FilterQuery<T>, { $inc: { count: 1 } } as never, { upsert: true });
      return true;
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      // Either the limit is reached, or another request created the row first: look and retry once.
      const row = await model.findOne(filter).lean<{ count: number }>();
      if (!row || row.count >= limit) return false;
    }
  }
  return false;
}

/** Gives a unit back (e.g. the AI call failed, so it shouldn't eat the quota). */
export async function refundDaily<T extends { count: number }>(model: Model<T>, filter: FilterQuery<T>) {
  await model.updateOne({ ...filter, count: { $gt: 0 } } as FilterQuery<T>, { $inc: { count: -1 } } as never);
}

export async function usedToday<T extends { count: number }>(model: Model<T>, filter: FilterQuery<T>) {
  const row = await model.findOne(filter).lean<{ count: number }>();
  return row?.count ?? 0;
}

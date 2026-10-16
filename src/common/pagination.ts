import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { FilterQuery, Model, PopulateOptions, SortOrder, Types } from 'mongoose';

export type Lean<T> = T & { _id: Types.ObjectId };

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

/** Returned by services for list endpoints; the response interceptor moves `meta` into the envelope. */
export class PageResult<T> {
  constructor(
    public readonly items: T[],
    public readonly page: number,
    public readonly limit: number,
    public readonly total: number,
    /** Extra values merged into the response meta (e.g. unread count). */
    public readonly extra: Record<string, unknown> = {},
  ) {}
}

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  query: PageQueryDto,
  options: { sort?: Record<string, SortOrder>; select?: string; populate?: string | PopulateOptions } = {},
): Promise<PageResult<Lean<T>>> {
  const { page, limit } = query;
  let find = model
    .find(filter)
    .sort(options.sort ?? { createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  if (options.select) find = find.select(options.select);
  if (options.populate) find = find.populate([options.populate].flat() as PopulateOptions[]);
  const [items, total] = await Promise.all([find.lean<Lean<T>[]>().exec(), model.countDocuments(filter)]);
  return new PageResult(items, page, limit, total);
}

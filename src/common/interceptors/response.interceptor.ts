import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { map } from 'rxjs';
import { PageResult } from '../pagination';

/** Wraps every successful response in `{ success, data, meta }`. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request & { id?: string }>();
    return next.handle().pipe(
      map((value) => {
        if (value instanceof PageResult) {
          return {
            success: true,
            data: value.items,
            meta: {
              requestId: req.id,
              page: value.page,
              limit: value.limit,
              total: value.total,
              ...value.extra,
            },
          };
        }
        return { success: true, data: value ?? null, meta: { requestId: req.id } };
      }),
    );
  }
}

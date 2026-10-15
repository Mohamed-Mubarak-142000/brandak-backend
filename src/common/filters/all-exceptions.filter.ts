import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError, ErrorDetail } from '../errors';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'HTTP_ERROR';
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else {
        const msg = (body as { message?: string | string[] }).message;
        if (Array.isArray(msg)) {
          code = 'VALIDATION_ERROR';
          message = 'Please review the submitted data';
          details = msg.map((m) => ({ field: m.split(' ')[0], reason: m }));
        } else if (msg) {
          message = msg;
        }
      }
    } else if (isDuplicateKeyError(exception)) {
      status = HttpStatus.CONFLICT;
      code = 'DUPLICATE';
      message = 'A record with the same unique value already exists';
      details = Object.keys(exception.keyValue ?? {}).map((field) => ({ field, reason: 'duplicate' }));
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(status).json({
      success: false,
      error: { code, message, ...(details?.length ? { details } : {}) },
      meta: { requestId: req.id },
    });
  }
}

function isDuplicateKeyError(e: unknown): e is { code: number; keyValue?: Record<string, unknown> } {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}

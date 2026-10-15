import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorDetail {
  field?: string;
  reason: string;
}

/** Domain error with a stable, machine-readable code the clients can switch on. */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }

  static notFound(entity: string) {
    return new AppError(`${entity.toUpperCase()}_NOT_FOUND`, `${entity} not found`, HttpStatus.NOT_FOUND);
  }

  static conflict(code: string, message: string) {
    return new AppError(code, message, HttpStatus.CONFLICT);
  }

  static forbidden(code = 'FORBIDDEN', message = 'You are not allowed to perform this action') {
    return new AppError(code, message, HttpStatus.FORBIDDEN);
  }

  static unprocessable(code: string, message: string, details?: ErrorDetail[]) {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}

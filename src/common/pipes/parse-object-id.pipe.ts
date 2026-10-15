import { Injectable, PipeTransform } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import { AppError } from '../errors';

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    // An invalid id can never match a record, so answer exactly like a missing one.
    if (!isValidObjectId(value)) throw new AppError('NOT_FOUND', 'Resource not found', 404);
    return value;
  }
}

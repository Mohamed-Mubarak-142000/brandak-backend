import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEnum } from 'class-validator';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser, Public } from '@/common/decorators';
import { FilePurpose } from '@/common/enums';
import { LocalStorageProvider } from './local-storage.provider';
import { MAX_UPLOAD_BYTES, UploadsService } from './uploads.service';

class UploadDto {
  @IsEnum(FilePurpose)
  purpose: FilePurpose;
}

@ApiTags('Uploads')
@Controller()
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly local: LocalStorageProvider,
  ) {}

  /** Upload first, then reference the returned id from the brand/product/payment request. */
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string', enum: Object.values(FilePurpose) },
      },
    },
  })
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('uploads')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  upload(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.uploads.upload(user.userId, dto.purpose, file);
  }

  /** Serves private files for the local storage driver (signed, expiring link). */
  @Public()
  @Get('files/private')
  servePrivate(@Query('token') token: string, @Query('sig') sig: string, @Res() res: Response) {
    const path = this.local.resolveSigned(token, sig);
    if (!path) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(path);
  }
}

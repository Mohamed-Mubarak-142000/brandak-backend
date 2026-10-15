import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '@/config/env';
import { CloudinaryStorageProvider } from './cloudinary-storage.provider';
import { StoredFile, StoredFileSchema } from './file.schema';
import { LocalStorageProvider } from './local-storage.provider';
import { STORAGE_PROVIDER } from './storage.provider';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: StoredFile.name, schema: StoredFileSchema }])],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    LocalStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService, LocalStorageProvider],
      useFactory: (config: ConfigService<Env, true>, local: LocalStorageProvider) =>
        config.get('STORAGE_DRIVER', { infer: true }) === 'cloudinary'
          ? new CloudinaryStorageProvider(config)
          : local,
    },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}

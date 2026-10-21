import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '@/users/users.module';
import { LedgerEntry, LedgerEntrySchema, PlatformSettings, PlatformSettingsSchema, Settlement, SettlementSchema } from './commission.schemas';
import { AdminCommissionsController, CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';

@Global()
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
      { name: LedgerEntry.name, schema: LedgerEntrySchema },
      { name: Settlement.name, schema: SettlementSchema },
    ]),
  ],
  controllers: [CommissionsController, AdminCommissionsController],
  providers: [CommissionsService],
  exports: [CommissionsService],
})
export class CommissionsModule {}

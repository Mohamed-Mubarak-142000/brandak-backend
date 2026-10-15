import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BrandMemberGuard } from '@/common/guards/brand-member.guard';
import { BrandMember, BrandMemberSchema } from './brand-member.schema';
import { BrandMembersService } from './brand-members.service';

/** Global so any feature module can protect `/brand/*` routes with BrandMemberGuard. */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: BrandMember.name, schema: BrandMemberSchema }])],
  providers: [BrandMembersService, BrandMemberGuard],
  exports: [BrandMembersService, BrandMemberGuard],
})
export class BrandMembersModule {}

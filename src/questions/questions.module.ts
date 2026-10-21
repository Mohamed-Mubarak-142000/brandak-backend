import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '@/users/users.module';
import { Question, QuestionSchema } from './question.schema';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Global()
@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: Question.name, schema: QuestionSchema }])],
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}

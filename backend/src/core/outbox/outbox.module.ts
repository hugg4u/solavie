import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxService } from './outbox.service';
import { InboxService } from './inbox.service';
import { ProcessedEventEntity } from './processed-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProcessedEventEntity])],
  providers: [OutboxService, InboxService],
  exports: [OutboxService, InboxService, TypeOrmModule],
})
export class OutboxModule {}

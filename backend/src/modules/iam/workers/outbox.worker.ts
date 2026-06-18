/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';

@Injectable()
export class IamOutboxWorker {
  private readonly logger = new Logger(IamOutboxWorker.name);

  constructor(
    @InjectRepository(IamOutboxEntity)
    private readonly outboxRepository: Repository<IamOutboxEntity>,
    @InjectQueue('iam_outbox') private outboxQueue: Queue,
    private readonly dataSource: DataSource,
  ) { }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleOutboxMessages() {
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    await this.dataSource.transaction(async (manager) => {
      const messages = await manager
        .createQueryBuilder(IamOutboxEntity, 'outbox')
        .where('outbox.status = :status', { status: 'PENDING' })
        .andWhere('outbox.createdAt < :date', { date: fiveMinutesAgo })
        .take(50)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (messages.length === 0) return;

      this.logger.warn(`Found ${messages.length} stuck outbox messages. Locking & Pushing to BullMQ...`);

      for (const msg of messages) {
        try {
          await this.outboxQueue.add('process_event', { eventId: msg.id });
          msg.status = 'PROCESSING';
          await manager.save(msg);
        } catch (error) {
          this.logger.error(`Failed to push stuck message ${msg.id} to BullMQ`, error);
        }
      }
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Brackets } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';
import { IamQueues, IamEventPriorities } from '../constants/iam.constants';

@Injectable()
export class IamOutboxWorker {
  private readonly logger = new Logger(IamOutboxWorker.name);

  constructor(
    @InjectRepository(IamOutboxEntity)
    private readonly outboxRepository: Repository<IamOutboxEntity>,
    @InjectQueue(IamQueues.OUTBOX) private outboxQueue: Queue,
    private readonly dataSource: DataSource,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleOutboxMessages() {
    const thirtySecondsAgo = new Date();
    thirtySecondsAgo.setSeconds(thirtySecondsAgo.getSeconds() - 30);

    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    const messagesToEnqueue: { id: string; eventType: string }[] = [];

    await this.dataSource.transaction(async (manager) => {
      const messages = await manager
        .createQueryBuilder(IamOutboxEntity, 'outbox')
        .where(
          new Brackets((mainQb) => {
            mainQb
              .where(
                new Brackets((qb) => {
                  qb.where(
                    '(outbox.status = :pendingStatus OR outbox.status = :failedStatus)',
                    {
                      pendingStatus: 'PENDING',
                      failedStatus: 'FAILED',
                    },
                  ).andWhere('outbox.createdAt < :createdAtLimit', {
                    createdAtLimit: thirtySecondsAgo,
                  });
                }),
              )
              .orWhere(
                new Brackets((qb) => {
                  qb.where('outbox.status = :processingStatus', {
                    processingStatus: 'PROCESSING',
                  }).andWhere('outbox.updatedAt < :updatedAtLimit', {
                    updatedAtLimit: fiveMinutesAgo,
                  });
                }),
              );
          }),
        )
        .andWhere('outbox.attempts < :maxAttempts', { maxAttempts: 5 })
        .take(50)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (messages.length === 0) return;

      this.logger.warn(
        `Found ${messages.length} stuck or failed outbox messages. Locking in DB...`,
      );

      const messageIds = messages.map((m) => m.id);

      // Batch update status and updatedAt within transaction
      await manager
        .createQueryBuilder()
        .update(IamOutboxEntity)
        .set({ status: 'PROCESSING', updatedAt: new Date() })
        .whereInIds(messageIds)
        .execute();

      // Collect data to process outside transaction
      messagesToEnqueue.push(
        ...messages.map((m) => ({ id: m.id, eventType: m.eventType })),
      );
    });

    // 2. Safely push to BullMQ outside DB transaction
    if (messagesToEnqueue.length > 0) {
      this.logger.warn(
        `Pushing ${messagesToEnqueue.length} stuck/failed messages to BullMQ...`,
      );
      for (const msg of messagesToEnqueue) {
        try {
          const priority = IamEventPriorities[msg.eventType] || 5;
          await this.outboxQueue.add(
            'process_event',
            { eventId: msg.id },
            { priority },
          );
        } catch (error) {
          this.logger.error(
            `Failed to push stuck message ${msg.id} to BullMQ. Reverting status to FAILED.`,
            error,
          );
          try {
            await this.outboxRepository.update(msg.id, {
              status: 'FAILED',
              errorReason: `Failed to enqueue to BullMQ: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
          } catch (dbErr) {
            this.logger.error(
              `Failed to revert message ${msg.id} status to FAILED`,
              dbErr,
            );
          }
        }
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeProcessedOutbox() {
    this.logger.log('Starting purge of processed and dead outbox events...');
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      // 1. Purge PROCESSED events older than 7 days
      const resultProcessed = await this.outboxRepository
        .createQueryBuilder()
        .delete()
        .where('status = :status', { status: 'PROCESSED' })
        .andWhere('createdAt < :date', { date: sevenDaysAgo })
        .execute();

      // 2. Purge DEAD_LETTER events older than 30 days
      const resultDead = await this.outboxRepository
        .createQueryBuilder()
        .delete()
        .where('status = :status', { status: 'DEAD_LETTER' })
        .andWhere('createdAt < :date', { date: thirtyDaysAgo })
        .execute();

      this.logger.log(
        `Purged ${resultProcessed.affected || 0} processed events (>7 days) and ${resultDead.affected || 0} dead letter events (>30 days).`,
      );
    } catch (error) {
      this.logger.error('Failed to purge old outbox events', error);
    }
  }
}

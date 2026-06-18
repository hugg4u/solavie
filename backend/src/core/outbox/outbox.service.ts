import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  // Ví dụ ta có queue chung tên là 'events' hoặc theo tên event
  constructor(
    private readonly dataSource: DataSource,
    // @InjectQueue('events') private readonly eventsQueue: Queue, // Có thể mở comment khi có queue cụ thể
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleOutboxPolling() {
    this.logger.debug('Polling outbox messages...');
    // Demo implementation. In a real system, you query an Outbox table.
    // Dùng FOR UPDATE SKIP LOCKED để nhiều worker không giành nhau.
    /*
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const messages = await queryRunner.query(
        `SELECT * FROM outbox WHERE status = 'PENDING' LIMIT 50 FOR UPDATE SKIP LOCKED`
      );

      for (const msg of messages) {
        // await this.eventsQueue.add(msg.eventType, msg.payload);
        await queryRunner.query(`UPDATE outbox SET status = 'PROCESSED' WHERE id = $1`, [msg.id]);
      }

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Error polling outbox', err);
    } finally {
      await queryRunner.release();
    }
    */
  }
}

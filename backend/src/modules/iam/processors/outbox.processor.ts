import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';

@Processor('iam_outbox')
@Injectable()
export class IamOutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(IamOutboxProcessor.name);

  constructor(
    @InjectRepository(IamOutboxEntity)
    private readonly outboxRepository: Repository<IamOutboxEntity>,
  ) {
    super();
  }

  async process(job: Job<{ eventId: string }, any, string>): Promise<any> {
    const { eventId } = job.data;
    
    const msg = await this.outboxRepository.findOne({ where: { id: eventId } });
    if (!msg || !['PENDING', 'PROCESSING'].includes(msg.status)) {
      this.logger.debug(`Event ${eventId} already processed or not found.`);
      return;
    }

    try {
      if (msg.eventType === 'auth.login_new_device') {
        const payload = msg.payload as Record<string, any>;
        this.logger.log(
          `[SECURITY ALERT] New device login detected for user ${payload.email} from IP: ${payload.ipAddress}. Simulating email...`,
        );
      }

      // Mark as processed
      msg.status = 'PROCESSED';
      await this.outboxRepository.save(msg);
    } catch (error) {
      this.logger.error(`Failed to process message ${eventId}`, error);
      msg.status = 'FAILED';
      msg.errorReason = error instanceof Error ? error.message : 'Unknown error';
      await this.outboxRepository.save(msg);
      throw error; // Let BullMQ handle retry mechanism
    }
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IamOutboxEntity } from '../entities/iam-outbox.entity';
import { IamEventTypes, IamQueues } from '../constants/iam.constants';

@Processor(IamQueues.OUTBOX)
@Injectable()
export class IamOutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(IamOutboxProcessor.name);

  constructor(
    @InjectRepository(IamOutboxEntity)
    private readonly outboxRepository: Repository<IamOutboxEntity>,
  ) {
    super();
  }

  async process(
    job: Job<
      { eventId?: string; eventType?: string; payload?: unknown },
      void,
      string
    >,
  ): Promise<void> {
    const { eventId, eventType, payload } = job.data;

    if (eventId) {
      // 1. Database-backed outbox event flow
      const msg =
        await this.outboxRepository.manager.transaction<IamOutboxEntity | null>(
          async (manager) => {
            const repo = manager.getRepository(IamOutboxEntity);
            const lockedMsg = await repo.findOne({
              where: { id: eventId },
              lock: { mode: 'pessimistic_write' },
            });

            if (lockedMsg) {
              if (
                lockedMsg.status === 'PROCESSED' ||
                lockedMsg.status === 'DEAD_LETTER'
              ) {
                return null;
              }
              if (lockedMsg.status === 'PROCESSING') {
                const fiveMinutesAgo = new Date();
                fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
                if (lockedMsg.updatedAt > fiveMinutesAgo) {
                  this.logger.debug(
                    `Event ${eventId} is currently being processed by another worker. Skipping.`,
                  );
                  return null;
                }
              }
              lockedMsg.status = 'PROCESSING';
              lockedMsg.updatedAt = new Date();
              return repo.save(lockedMsg);
            }
            return null;
          },
        );

      if (!msg) {
        this.logger.debug(
          `Event ${eventId} already processed, processing, or not found.`,
        );
        return;
      }

      const activeMsg = msg;

      try {
        this.executeEventLogic(
          activeMsg.eventType,
          activeMsg.payload as unknown,
        );

        activeMsg.status = 'PROCESSED';
        await this.outboxRepository.save(activeMsg);
      } catch (error) {
        this.logger.error(
          `Failed to process DB-backed message ${eventId}`,
          error,
        );

        activeMsg.attempts = (activeMsg.attempts || 0) + 1;
        if (activeMsg.attempts >= 5) {
          activeMsg.status = 'DEAD_LETTER';
          this.logger.error(
            `Message ${eventId} has failed 5 times and is marked as DEAD_LETTER.`,
          );
        } else {
          activeMsg.status = 'FAILED';
        }

        activeMsg.errorReason =
          error instanceof Error ? error.message : 'Unknown error';
        await this.outboxRepository.save(activeMsg);
        throw error;
      }
    } else if (eventType && payload) {
      // 2. Direct event flow (bypasses DB transaction completely)
      try {
        this.executeEventLogic(eventType, payload);
      } catch (error) {
        this.logger.error(`Failed to process direct event ${eventType}`, error);
        throw error;
      }
    }
  }

  private executeEventLogic(eventType: string, payload: unknown): void {
    const data = payload as Record<string, unknown>;
    switch (eventType as IamEventTypes) {
      case IamEventTypes.AUTH_LOGIN_NEW_DEVICE:
        this.logger.log(
          `[SECURITY ALERT] New device login detected for user ${String(data.email)} from IP: ${String(data.ipAddress)}. Simulating email...`,
        );
        break;
      case IamEventTypes.AUTH_USER_CREATED:
        this.logger.log(
          `[USER CREATION] Activation email sent to ${String(data.email)} (token: ${String(data.activationToken)})`,
        );
        break;
      case IamEventTypes.AUTH_PASSWORD_CHANGED:
        this.logger.log(
          `[SECURITY ALERT] Password changed for user ${String(data.userId)} from IP: ${String(data.ipAddress)}. Simulating email...`,
        );
        break;
      case IamEventTypes.PERMISSION_CHANGED:
        this.logger.log(
          `[PERMISSION ALERT] Permissions changed for user ${String(data.affectedUserId)} by ${String(data.changedBy)}. Type: ${String(data.changeType)}.`,
        );
        break;
      default:
        this.logger.warn(`Unknown outbox event type: ${eventType}`);
        break;
    }
  }
}

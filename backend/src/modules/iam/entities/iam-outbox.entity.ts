import { Entity } from 'typeorm';
import { BaseOutboxEntity } from '../../../core/outbox/outbox.entity';

@Entity('iam_outbox_events')
export class IamOutboxEntity extends BaseOutboxEntity {}

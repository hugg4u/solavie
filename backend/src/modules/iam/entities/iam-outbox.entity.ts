import { Entity } from 'typeorm';
import { BaseOutboxEntity } from '../../../core/outbox/outbox.entity';
import { IamTables } from '../constants/iam.constants';

@Entity(IamTables.OUTBOX_EVENTS)
export class IamOutboxEntity extends BaseOutboxEntity {}

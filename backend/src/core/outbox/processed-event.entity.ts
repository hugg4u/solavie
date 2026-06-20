import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('core_processed_events')
export class ProcessedEventEntity {
  @PrimaryColumn('uuid', { name: 'event_id' })
  eventId: string;

  @PrimaryColumn('varchar', { name: 'consumer_name', length: 100 })
  consumerName: string;

  @CreateDateColumn({ name: 'processed_at' })
  processedAt: Date;
}

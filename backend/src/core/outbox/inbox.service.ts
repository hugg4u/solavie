import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProcessedEventEntity } from './processed-event.entity';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(ProcessedEventEntity)
    private readonly processedEventRepo: Repository<ProcessedEventEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Chạy hàm xử lý nghiệp vụ của consumer một cách idempotent.
   * Nếu event đã được xử lý bởi consumer này trước đó, hàm xử lý sẽ được bỏ qua.
   * Trả về true nếu xử lý thành công, trả về false nếu bị bỏ qua do trùng lặp.
   */
  async executeIdempotent(
    eventId: string,
    consumerName: string,
    handler: () => Promise<void>,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProcessedEventEntity);

      // 1. Kiểm tra xem sự kiện đã được tiêu thụ bởi consumer này chưa
      const exists = await repo.findOne({
        where: { eventId, consumerName },
      });

      if (exists) {
        return false; // Đã xử lý rồi, bỏ qua
      }

      // 2. Chạy logic nghiệp vụ thực tế
      await handler();

      // 3. Ghi nhận đã xử lý thành công trong cùng transaction
      const record = repo.create({ eventId, consumerName });
      await repo.save(record);

      return true;
    });
  }
}

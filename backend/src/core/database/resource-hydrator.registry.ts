import { Injectable, Logger } from '@nestjs/common';
import { ResourceHydrator } from './resource-hydrator.interface';

@Injectable()
export class ResourceHydratorRegistry {
  private readonly logger = new Logger(ResourceHydratorRegistry.name);
  private readonly hydrators = new Map<string, ResourceHydrator>();

  /**
   * Đăng ký một Hydrator mới với hệ thống.
   * 
   * @param resourcePrefix Tiền tố nhận diện (ví dụ: 'crm.lead', 'booking.ticket')
   * @param hydrator Lớp thực thi ResourceHydrator
   */
  register(resourcePrefix: string, hydrator: ResourceHydrator): void {
    if (this.hydrators.has(resourcePrefix)) {
      this.logger.warn(`ResourceHydrator for prefix "${resourcePrefix}" is being overwritten!`);
    }
    this.hydrators.set(resourcePrefix, hydrator);
    this.logger.log(`Registered ResourceHydrator for resource type: [${resourcePrefix}]`);
  }

  /**
   * Lấy Hydrator tương ứng dựa trên tiền tố permission.
   */
  get(resourcePrefix: string): ResourceHydrator | undefined {
    return this.hydrators.get(resourcePrefix);
  }
}

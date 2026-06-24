# Đặc Tả Thiết Kế: Cơ Chế Nạp Tài Nguyên Phân Quyền (Resource Hydrator Spec)

Đặc tả này quy định chi tiết về cấu trúc, cách thức triển khai và quy trình phối hợp của cơ chế `ResourceHydrator` nhằm giải quyết bài toán phân quyền động (ABAC) giữa Module IAM và các Module nghiệp vụ khác một cách độc lập (Decoupled).

---

## 1. Kiến Trúc Tổng Quan (Conceptual Architecture)

Trong mô hình phân quyền ABAC, các quy tắc logic yêu cầu so khớp thuộc tính của đối tượng thực thi (User) với thuộc tính của đối tượng bị tác động (Resource) - Ví dụ: `user.id == resource.assigneeId`.

Để tránh việc Module IAM phải truy vấn cơ sở dữ liệu của các module khác (gây phụ thuộc cứng - Tight Coupling), hệ thống sử dụng mô hình **Registry & Interface**:
1. **Core Interface (`ResourceHydrator`):** Định nghĩa hợp đồng chung về hành vi nạp dữ liệu.
2. **Registry (`ResourceHydratorRegistry`):** Kho lưu trữ tập trung các dịch vụ nạp dữ liệu, cho phép các module đăng ký động.
3. **IAM Guard (`PermissionsGuard`):** Nơi tiêu thụ dữ liệu, tự động tìm kiếm Hydrator phù hợp dựa trên tiền tố của Permission (Permission Prefix) để nạp dữ liệu trước khi đánh giá biểu thức logic.

```
+-------------------------------------------------------------+
|                        Module Core                          |
|  +---------------------------+  +------------------------+  |
|  | Interface ResourceHydrator|  |HydratorRegistry (Store)|  |
|  +---------------------------+  +------------------------+  |
+---------------------------------------------^---------------+
                                              | register()
+---------------------------------------------|---------------+
|                        Module Nghiệp Vụ      |               |
|  +---------------------------+              |               |
|  | CustomerHydrator (CRM Module) |--------------+               |
|  +---------------------------+                              |
+-------------------------------------------------------------+
                                              | get()
+---------------------------------------------|---------------+
|                        Module IAM           |               |
|  +---------------------------+              |               |
|  | PermissionsGuard (AuthZ)  |<-------------+               |
|  +---------------------------+                              |
+-------------------------------------------------------------+
```

---

## 2. Đặc Tả Chi Tiết Mã Nguồn (Technical API Design)

### 2.1. Khai báo Interface `ResourceHydrator`
Mọi service thực hiện nạp dữ liệu phân quyền bắt buộc phải triển khai interface này. Interface này được định nghĩa tại thư mục Core của dự án:

```typescript
// src/core/database/resource-hydrator.interface.ts

export interface ResourceHydrator {
  /**
   * Tải tài nguyên từ Database lên RAM dựa trên ID của tài nguyên.
   * 
   * @param resourceId Định danh của tài nguyên cần tải (UUID hoặc string)
   * @returns Đối tượng chứa các thuộc tính cần thiết cho ABAC, hoặc null nếu không tìm thấy.
   */
  fetchResource(resourceId: string): Promise<Record<string, any> | null>;
}
```

*Tiêu chuẩn Tối ưu Hiệu năng:*
> [!IMPORTANT]
> Khi thực hiện hàm `fetchResource`, lập trình viên **chỉ được SELECT** các cột thực sự cần thiết cho việc đánh giá chính sách (ví dụ: `id`, `assigneeId`, `status`, `organizationId`). Tuyệt đối không load các quan hệ (relations) cồng kềnh hoặc các trường dữ liệu nặng (như JSON, Text dài) để tránh quá tải bộ nhớ và làm chậm tốc độ Guard.

### 2.2. Khai báo Registry `ResourceHydratorRegistry`
Service này đóng vai trò là "Tổng đài" quản lý vòng đời và lưu trữ các Hydrator:

```typescript
// src/core/database/resource-hydrator.registry.ts

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
```

---

## 3. Quy Trình Phối Hợp & Tích Hợp (Integration Steps)

### Bước 1: Khai báo ở Module Nghiệp vụ
Khi viết một module mới (ví dụ: CRM), lập trình viên tạo service `CustomerHydrator` triển khai interface `ResourceHydrator` và đăng ký nó với Registry trong pha khởi động Module:

```typescript
// src/modules/crm/services/customer-hydrator.service.ts

import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceHydrator } from '../../../core/database/resource-hydrator.interface';
import { ResourceHydratorRegistry } from '../../../core/database/resource-hydrator.registry';
import { CustomerEntity } from '../entities/customer.entity';

@Injectable()
export class CustomerHydrator implements ResourceHydrator, OnModuleInit {
  constructor(
    @InjectRepository(CustomerEntity)
    private readonly customerRepo: Repository<CustomerEntity>,
    private readonly registry: ResourceHydratorRegistry,
  ) {}

  // Đăng ký tự động khi Module CRM khởi động
  onModuleInit() {
    this.registry.register('crm.customer', this);
  }

  async fetchResource(id: string): Promise<Record<string, any> | null> {
    // Chỉ lấy các trường cần dùng để check ABAC
    return this.customerRepo.findOne({
      where: { id },
      select: { id: true, assigneeId: true, stageId: true },
    });
  }
}
```

### Bước 1.2: Khai báo ở Chatbot/Inbox Module (ConversationHydrator)
Đối với các thao tác đọc ghi trên các phiên hội thoại, Chatbot Module cung cấp `ConversationHydrator` để nạp dữ liệu check quyền ABAC cho nhân viên (ví dụ: Sales chỉ được quyền sửa/đóng cuộc chat do mình hoặc chi nhánh mình phụ trách):

```typescript
// src/modules/chatbot/services/conversation-hydrator.service.ts

import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceHydrator } from '../../../core/database/resource-hydrator.interface';
import { ResourceHydratorRegistry } from '../../../core/database/resource-hydrator.registry';
import { ConversationEntity } from '../entities/conversation.entity';

@Injectable()
export class ConversationHydrator implements ResourceHydrator, OnModuleInit {
  constructor(
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    private readonly registry: ResourceHydratorRegistry,
  ) {}

  // Đăng ký tự động với tiền tố chatbot.conversation
  onModuleInit() {
    this.registry.register('chatbot.conversation', this);
  }

  async fetchResource(id: string): Promise<Record<string, any> | null> {
    // Chỉ load các trường cơ bản phục vụ check quyền sở hữu và phân phối
    return this.conversationRepo.findOne({
      where: { id },
      select: { id: true, assigneeId: true, customerId: true, channel: true },
    });
  }
}
```

### Bước 2: Trích xuất thông tin tự động tại PermissionsGuard
Tại module IAM, [PermissionsGuard](file:///d:/workspace/project/solavie/backend/src/modules/iam/guards/permissions.guard.ts) sẽ tự động nạp dữ liệu (Hydrate) khi phát hiện yêu cầu kiểm tra quyền:

```typescript
// Logic trích xuất trong canActivate() của PermissionsGuard:

const request = context.switchToHttp().getRequest();
const requiredPermissions = this.reflector.get<string[]>(PERMISSIONS_KEY, context.getHandler());

// Giả sử permission yêu cầu là 'crm.customer.write'
for (const permission of requiredPermissions) {
  // Lấy ID tài nguyên từ URL params (e.g. request.params.id)
  const resourceId = request.params.id || request.body.resourceId; 

  if (resourceId) {
    // 1. Phân tích prefix (lấy tất cả trừ phần action cuối cùng)
    // Ví dụ: 'crm.customer.write' -> 'crm.customer'
    const lastDotIndex = permission.lastIndexOf('.');
    if (lastDotIndex > 0) {
      const resourcePrefix = permission.substring(0, lastDotIndex);

      // 2. Tìm Hydrator trong Registry
      const hydrator = this.hydratorRegistry.get(resourcePrefix);
      if (hydrator) {
        try {
          // 3. Gọi hàm fetch nạp dữ liệu lên RAM
          const resourceData = await hydrator.fetchResource(resourceId);
          
          if (resourceData) {
            // 4. Gắn vào request context để json-logic-js so khớp
            request.hydratedResource = resourceData;
            break; // Đã tìm thấy và nạp thành công
          }
        } catch (err) {
          this.logger.error(`Error hydrating resource ${resourceId} for prefix ${resourcePrefix}`, err);
        }
      }
    }
  }
}
```

---

## 4. Quy Tắc Đặt Tên Permission & Cấu Hình Params

Để cơ chế này hoạt động chính xác một cách tự động, toàn hệ thống phải tuân thủ nghiêm ngặt quy tắc đặt tên sau:

1. **Quy tắc đặt tên Permission:**
   `[tên_module].[tên_tài_nguyên].[hành_động]`
   *   *Hợp lệ:* `crm.lead.update`, `booking.ticket.cancel`, `storage.file.delete`.
   *   *Không hợp lệ:* `leadUpdate` (thiếu phân cấp dot), `crm.lead` (thiếu hành động).
2. **Quy tắc trích xuất Resource ID từ Request:**
   Mặc định, Guard sẽ tìm Resource ID ở các vị trí theo thứ tự ưu tiên:
   *   `request.params.id` (URL Path Parameter)
   *   `request.body.id` hoặc `request.body.resourceId` (Request Body)
   *   `request.query.id` hoặc `request.query.resourceId` (Query Parameter)

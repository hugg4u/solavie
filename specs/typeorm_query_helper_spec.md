# Đặc Tả Kiến Trúc Tiện Ích Truy Vấn Danh Sách (TypeOrmQueryHelper Specification)

Tài liệu này đặc tả cấu trúc thiết kế, cách thức vận hành và quy chuẩn triển khai bộ lọc, phân trang, tìm kiếm và sắp xếp động cho toàn bộ các API lấy danh sách (List APIs) trong hệ thống Solavie sử dụng NestJS và TypeORM.

---

## 1. Mục Tiêu Thiết Kế (Design Objectives)

- **Đồng bộ 100% (Consistency):** Tất cả các API danh sách đều phải trả về định dạng dữ liệu giống nhau.
- **Giảm mã lặp (DRY - Don't Repeat Yourself):** Tránh viết thủ công các câu lệnh `andWhere`, `orderBy`, `skip`, `take` lặp đi lặp lại ở tầng Service.
- **Tối ưu hiệu năng (Performance):** Ép buộc phân trang ở cấp cơ sở dữ liệu (Database level) bằng `LIMIT` và `OFFSET`.
- **Dễ dàng mở rộng (Extensibility):** Hỗ trợ nạp động bộ lọc chính xác, tìm kiếm đa trường và sắp xếp trên bất kỳ thực thể TypeORM nào chỉ bằng cách khai báo cấu hình.

---

## 2. Đặc Tả Dữ Liệu Đầu Vào & Đầu Ra (Contract Specification)

### A. Định Dạng Query Dto Đầu Vào
Mọi DTO truy vấn danh sách đều phải kế thừa từ `PaginationQueryDto` và có cấu trúc:

```typescript
export class PaginationQueryDto {
  page?: number = 1;       // Trang hiện tại (min 1)
  limit?: number = 20;     // Số dòng tối đa trên 1 trang (min 1, max 100)
}

export class ListQueryDto extends PaginationQueryDto {
  search?: string;         // Từ khóa tìm kiếm tương đối (LIKE %keyword%)
  sort?: string;           // Cột cần sắp xếp (ví dụ: 'code', 'name', 'createdAt')
  order?: 'ASC' | 'DESC';  // Hướng sắp xếp
}
```

### B. Định Dạng JSON Trả Về Đầu Ra
Toàn bộ API danh sách phải trả về cấu trúc bọc bởi `PaginatedResponseDto<T>`:

```json
{
  "statusCode": 200,
  "timestamp": "2026-06-20T12:00:00.000Z",
  "traceId": "uuid-trace-id",
  "errorCode": null,
  "message": "Request successful",
  "data": [
    { "id": "uuid-1", "name": "Bản ghi 1", "createdAt": "..." },
    { "id": "uuid-2", "name": "Bản ghi 2", "createdAt": "..." }
  ],
  "meta": {
    "total": 45,
    "page": 1,
    "limit": 20,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

## 3. Thiết Kế Tiện Ích `TypeOrmQueryHelper`

Tiện ích sẽ được đặt tại `src/core/database/typeorm-query.helper.ts`.

### Interface Cấu Hình (Options Interface)
```typescript
export interface QueryHelperOptions {
  alias: string;               // Alias của bảng chính đang query (ví dụ: 'user')
  searchFields?: string[];     // Các trường văn bản cần áp dụng tìm kiếm tương đối (ví dụ: ['user.fullName', 'user.email'])
  filterableFields?: string[]; // Các trường hỗ trợ lọc chính xác bằng dấu bằng (ví dụ: ['isActive', 'roleId'])
}
```

### Quy Trình Xử Lý Của Helper (Execution Flow)
1. **Tìm Kiếm (Search):** Nếu có `query.search`, gom nhóm các trường `searchFields` bằng phép `OR`, so sánh kiểu không phân biệt hoa thường bằng `LOWER(field) LIKE LOWER(:search)`.
2. **Bộ Lọc (Filter):** Quét qua `filterableFields`. Nếu giá trị của trường đó có trong DTO và khác rỗng, tự động áp dụng `andWhere` với dấu `=`. Chuyển đổi các giá trị chuỗi đặc biệt như `'true'`, `'false'` sang kiểu `boolean` tương ứng.
3. **Sắp Xếp (Sort):** Nếu có `query.sort`, kiểm tra tính hợp lệ của trường sắp xếp (để tránh SQL Injection), sau đó chèn `.orderBy("alias.sortField", order)`.
4. **Phân Trang (Pagination):** Thực hiện tính toán `skip` và `take` để chèn `.skip(skip).take(limit)`.

---

## 4. Hướng Dẫn Tích Hợp Cho Các Module Khác
 
### 4.1. Tích Hợp Cho Module CRM (Quản lý Lead)
 
#### Bước 1: Tạo DTO Kế Thừa
```typescript
import { IsOptional, IsString, IsBooleanString } from 'class-validator';
import { PaginationQueryDto } from 'src/core/dto/pagination.dto';
 
export class CrmLeadListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
 
  @IsOptional()
  @IsString()
  status?: string; // Bộ lọc theo trạng thái Lead
 
  @IsOptional()
  @IsBooleanString()
  isHighValue?: string; // Bộ lọc Lead giá trị cao
}
```
 
#### Bước 2: Tích Hợp Helper Trong Service
```typescript
import { TypeOrmQueryHelper } from 'src/core/database/typeorm-query.helper';
 
async findAll(query: CrmLeadListQueryDto): Promise<PaginatedResponseDto<LeadEntity>> {
  const qb = this.leadRepository.createQueryBuilder('lead');
 
  TypeOrmQueryHelper.apply(qb, query, {
    alias: 'lead',
    searchFields: ['lead.title', 'lead.contactName', 'lead.phone'],
    filterableFields: ['status', 'isHighValue'], // Các trường khớp 100% với DTO và DB
  });
 
  const [data, total] = await qb.getManyAndCount();
  return new PaginatedResponseDto(data, total, query.page || 1, query.limit || 20);
}
```
 
#### Bước 3: Đón Nhận Query Tham Số Trong Controller
```typescript
@Get()
async findAll(@Query() query: CrmLeadListQueryDto) {
  return this.crmLeadService.findAll(query);
}
```

### 4.2. Tích Hợp Cho Module Chatbot (Chiến Dịch Gửi Tin & Log Chi Tiết)

Đối với các chiến dịch gửi tin hàng loạt, lượng log phát sinh có thể lên tới hàng chục vạn dòng cho mỗi chiến dịch. Việc ép buộc phân trang và tối ưu hóa câu lệnh query là tối quan trọng:

#### 1. Quản lý Danh sách Chiến dịch (`chat_broadcast_campaigns`)
```typescript
// DTO truy vấn chiến dịch
export class BroadcastCampaignListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() channel?: 'FACEBOOK' | 'ZALO';
  @IsOptional() @IsString() status?: string;
}

// Service logic áp dụng Helper
async findCampaigns(query: BroadcastCampaignListQueryDto): Promise<PaginatedResponseDto<BroadcastCampaignEntity>> {
  const qb = this.campaignRepo.createQueryBuilder('campaign');
  
  TypeOrmQueryHelper.apply(qb, query, {
    alias: 'campaign',
    searchFields: ['campaign.name'],
    filterableFields: ['channel', 'status'],
  });
  
  const [data, total] = await qb.getManyAndCount();
  return new PaginatedResponseDto(data, total, query.page || 1, query.limit || 20);
}
```

#### 2. Truy vấn Log Gửi tin Chi tiết (`chat_broadcast_logs`)
Với Log chi tiết, hệ thống cần hỗ trợ tìm kiếm theo Họ tên hoặc SĐT khách hàng (nằm bên bảng `crm_customers` được liên kết mềm):

```typescript
// DTO truy vấn log chi tiết
export class BroadcastLogListQueryDto extends PaginationQueryDto {
  @IsNotEmpty() @IsUUID() campaignId: string; // Bắt buộc lọc theo ID chiến dịch
  @IsOptional() @IsString() search?: string;    // Tìm kiếm theo tên/SĐT khách hàng
  @IsOptional() @IsString() status?: 'SENT' | 'FAILED' | 'SKIPPED';
}

// Service logic JOIN mềm và tìm kiếm đa trường
async findCampaignLogs(query: BroadcastLogListQueryDto): Promise<PaginatedResponseDto<BroadcastLogEntity>> {
  const qb = this.logRepo.createQueryBuilder('blog')
    // Thực hiện INNER JOIN mềm để nạp thông tin khách hàng hỗ trợ tìm kiếm
    .innerJoin('crm_customers', 'customer', 'blog.customer_id = customer.id');
    
  TypeOrmQueryHelper.apply(qb, query, {
    alias: 'blog',
    searchFields: ['customer.full_name', 'customer.phone_number'],
    filterableFields: ['campaignId', 'status'],
  });
  
  const [data, total] = await qb.getManyAndCount();
  return new PaginatedResponseDto(data, total, query.page || 1, query.limit || 20);
}
```


---

## 5. Quy Tắc Bảo Mật & Rủi Ro (Security & Guardrails)

- **SQL Injection Prevention:** Không bao giờ chèn trực tiếp chuỗi `query.sort` hay `query.search` thô vào query builder bằng cộng chuỗi. Bắt buộc dùng tham số hóa (Parameters bindings) như `:search` và chỉ sắp xếp theo định dạng tên cột chuẩn (`^[a-zA-Z0-9_.]+$`).
- **Phân Trang Bắt Buộc:** Nếu client gửi request không truyền `limit`, hệ thống tự động gán mặc định `limit = 20`. Tuyệt đối không cho phép query danh sách không giới hạn ở các bảng động.

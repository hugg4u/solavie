# Thiết Kế Kiến Trúc Module CRM (Design)

## 1. Thiết Kế Database (Lược Đồ Quan Hệ)
Module CRM bao gồm các bảng chính sau, sử dụng khóa chính dạng UUID và thiết kế chuẩn Microservices-ready.

### 1.1. Bảng `crm_customers` (Hồ Sơ Khách Hàng)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh khách hàng duy nhất |
| `full_name` | VARCHAR(255) | | Họ tên khách hàng |
| `phone_number` | VARCHAR(50) | | Số điện thoại |
| `email` | VARCHAR(255) | | Địa chỉ email |
| `stage_id` | UUID | FOREIGN KEY | Trạng thái hiện tại trong Pipeline |
| `location` | VARCHAR(100) | | Tỉnh/Thành phố lắp đặt |
| `assignee_id` | UUID | | Sales phụ trách (Soft link tới IAM) |
| `lead_score` | INTEGER | Default 0 | Điểm tiềm năng tính toán động |
| `lead_temperature`| VARCHAR(20) | Default 'COLD' | Phân nhóm tiềm năng (`COLD`, `WARM`, `HOT`) |
| `custom_fields` | JSONB | Default '{}' | Các thông số nhu cầu Solar động |
| `roi_estimation` | JSONB | Default '{}' | Ước tính sản lượng, công suất, hoàn vốn |
| `facebook_psid` | VARCHAR(255) | | Liên kết với định danh Messenger |
| `zalo_user_id` | VARCHAR(255) | | Liên kết với định danh Zalo |

### 1.2. Bảng `crm_field_definitions` (Định nghĩa trường động)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh trường |
| `field_key` | VARCHAR(50) | UNIQUE, NOT NULL | Khóa kỹ thuật (ví dụ: `roof_area`) |
| `label` | VARCHAR(100) | NOT NULL | Nhãn hiển thị |
| `data_type` | VARCHAR(30) | NOT NULL | Kiểu dữ liệu (`TEXT`, `NUMBER`, `SELECT`...) |
| `is_required` | BOOLEAN | Default FALSE | Bắt buộc nhập hay không |

### 1.3. Bảng `crm_stages` (Cấu hình trạng thái Pipeline)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh trạng thái |
| `name` | VARCHAR(100) | NOT NULL | Tên hiển thị (VD: "Khảo sát") |
| `color_code` | VARCHAR(30) | | Mã màu giao diện |
| `sort_order` | INTEGER | NOT NULL | Thứ tự trên Kanban Board |
| `win_probability`| INTEGER | NOT NULL | Tỷ lệ thành công (%) |
| `required_fields`| JSONB | | Mảng các field bắt buộc nhập để vào stage này |
| `is_system` | BOOLEAN | Default FALSE | Trạng thái do AI hay do con người |

### 1.4. Bảng `crm_scoring_rules` (Luật tính điểm)
| Tên Trường | Kiểu Dữ Liệu | Thuộc Tính | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh quy tắc |
| `criteria_key` | VARCHAR(50) | NOT NULL | Thuộc tính so sánh (`monthly_bill`...) |
| `operator` | VARCHAR(30) | NOT NULL | Toán tử (`GREATER_THAN`, `NOT_EMPTY`...) |
| `comparison_value`| VARCHAR(255) | | Giá trị so sánh đối chiếu |
| `score_weight` | INTEGER | NOT NULL | Số điểm cộng/trừ |
| `is_active` | BOOLEAN | Default TRUE | Kích hoạt |

## 2. Thiết Kế API Endpoints (RESTful)

### 2.1. Customer Management
- `GET /api/v1/crm/customers`: Lấy danh sách khách hàng (Hỗ trợ phân trang, lọc theo stage, score).
- `GET /api/v1/crm/customers/:id`: Lấy chi tiết khách hàng và timeline.
- `POST /api/v1/crm/customers`: Tạo hồ sơ mới.
- `PUT /api/v1/crm/customers/:id`: Cập nhật thông tin.
- `PATCH /api/v1/crm/customers/:id/stage`: Cập nhật trạng thái Pipeline.

### 2.2. Configuration Management (Admin Only)
- `GET/POST/PUT /api/v1/crm/settings/fields`: Quản lý Custom Fields.
- `GET/POST/PUT /api/v1/crm/settings/stages`: Quản lý Pipeline Stages.
- `GET/POST/PUT /api/v1/crm/settings/scoring-rules`: Quản lý Scoring Rules.

### 2.3. Solar Logic
- `POST /api/v1/crm/customers/:id/roi-calculate`: Tính toán lại ROI dựa trên custom_fields mới.

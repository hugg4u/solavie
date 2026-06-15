# CRM DESIGN & ARCHITECTURE PROPOSALS
## Hệ Thống Solavie Platform (Phase 1)

| Tài liệu | CRM Design & Architecture Proposals |
| --- | --- |
| Dự án | Hệ thống AI Chatbot kết hợp CRM & O&M cho Năng lượng mặt trời Solavie |
| Phiên bản | 1.1.0 (Bản cải tiến sau Phản biện) |
| Ngày cập nhật | 2026-06-15 |
| Trạng thái | Chờ duyệt |

---

## 1. Thảo Luận Phản Biện: Gộp Bảng Lead & Customer Làm Một

Hoàng tử đã đưa ra một câu hỏi phản biện vô cùng sắc bén: **"Tại sao phải tách riêng bảng Lead và Customer làm gì, sao không phải là một thực thể duy nhất?"**

Công chúa xin phép phân tích và phản biện sâu sắc về vấn đề này:

### 1.1. Đánh giá Thiết kế Tách bảng (Truyền thống)
*   **Mục đích**: Giữ cho database khách hàng chính thức luôn "sạch", tránh bị ô nhiễm bởi hàng ngàn lead rác (spam chat từ facebook/zalo) chưa được xác thực thông tin.
*   **Nhược điểm**:
    1.  **Trùng lặp dữ liệu (Data Redundancy)**: Khi một Lead ký hợp đồng thành Customer, hệ thống bắt buộc phải copy toàn bộ thông tin từ bảng `crm_leads` sang `crm_customers`, sau đó xóa hoặc ẩn Lead. Điều này gây lãng phí bộ nhớ và tăng nguy cơ bất đồng bộ dữ liệu.
    2.  **Đứt gãy dòng thời gian (Broken Activity Timeline)**: Lịch sử hội thoại của khách hàng lúc còn là Lead nằm ở một ID cũ. Khi chuyển sang Customer với ID mới, việc mapping hoặc di chuyển lịch sử tin nhắn và hoạt động rất phức tạp, dễ làm mất đi cái nhìn toàn diện (Customer 360).
    3.  **Khó bảo trì**: Tăng số lượng bảng và logic DTO chuyển đổi chéo trong mã nguồn NestJS.

### 1.2. Đánh giá Thiết kế Gộp bảng (Hiện đại & Tối ưu - Gợi ý từ Hoàng tử)
*   **Mục đích**: Quản lý một đối tượng duy nhất xuyên suốt hành trình cuộc đời của họ tại Solavie (Single Customer View).
*   **Giải pháp**: Gộp chung thành một bảng duy nhất mang tên **`crm_customers`** (hoặc `crm_contacts`), phân biệt giai đoạn hành trình thông qua trường **`stage_id`** (Soft link đến bảng cấu hình trạng thái động).
*   **Lợi ích vượt trội**:
    1.  **Duy nhất & Nhất quán**: Mỗi khách hàng chỉ có duy nhất một UUID từ lúc là một tài khoản Facebook chat lạ hoắc, qua quá trình tư vấn, khảo sát, cho đến khi lắp đặt và bảo trì (O&M ở phase sau). Toàn bộ lịch sử hoạt động (Activity Timeline) được lưu giữ liên tục và gắn chặt vào ID duy nhất này.
    2.  **Triệt tiêu trùng lặp**: Việc chuyển đổi trạng thái từ Lead tiềm năng sang Khách hàng chính thức chỉ tốn đúng 1 câu lệnh cập nhật trường trạng thái:
        ```sql
        UPDATE crm_customers SET stage_id = :stage_id_customer WHERE id = :id;
        ```
    3.  **Hạ tầng Microservices Gọn nhẹ**: Giảm số lượng bảng, đơn giản hóa logic nghiệp vụ của CRM Service.

**⇒ Quyết định thiết kế**: Đồng ý gộp **`crm_leads`** và **`crm_customers`** thành một bảng duy nhất là **`crm_customers`** để tối ưu hóa kiến trúc dữ liệu và hành trình khách hàng.

---

## 2. Thiết Kế Cơ Chế Đánh Giá Độ Tiềm Năng Động (Dynamic Lead Scoring)

Để đánh giá mức độ quan tâm và khả năng chốt hợp đồng của khách hàng một cách tự động và linh hoạt mà không bị hardcode trong mã nguồn, hệ thống xây dựng một **Dynamic Rule Engine** đơn giản.

```
                  [Khách hàng cập nhật thông tin / Có hoạt động mới]
                                         │
                                         ▼
                            [Dynamic Scoring Engine]
                      Quét qua các quy tắc hoạt động trong
                             `crm_scoring_rules`
                                         │
                                         ▼
                            [Cộng dồn điểm số (Score)]
                                         │
                                         ▼
                         [Phân loại mức độ tiềm năng]
                    - Score < 40: COLD (Tiềm năng thấp)
                    - Score 40-70: WARM (Tiềm năng trung bình)
                    - Score > 70: HOT (Tiềm năng cao)
```

### 2.1. Thiết Kế Database Cho Scoring Engine
Hệ thống quản lý luật tính điểm bằng bảng **`crm_scoring_rules`**:

| Tên Trường | Kiểu Dữ Liệu | Ràng Buộc | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh quy tắc |
| `criteria_key` | VARCHAR(50) | NOT NULL | Trường thuộc tính cần đánh giá (ví dụ: `monthly_bill`, `roof_area`, `location`, `has_phone`) |
| `operator` | VARCHAR(30) | NOT NULL | Toán tử so sánh (`GREATER_THAN`, `LESS_THAN`, `EQUAL`, `NOT_EMPTY`) |
| `comparison_value`| VARCHAR(255) | | Giá trị để đối chiếu |
| `score_weight` | INTEGER | NOT NULL | Điểm số cộng/trừ (ví dụ: `+30`, `-10`) |
| `is_active` | BOOLEAN | Default TRUE | Trạng thái kích hoạt |

### 2.2. Ví Dụ Cấu Hình Quy Tắc Đánh Giá Độ Tiềm Năng Động
Admin có thể thiết lập các quy tắc sau trên giao diện Dashboard:
*   Nếu `custom_fields.monthly_bill` > `3,000,000` VNĐ $\rightarrow$ **+30 điểm** (Nhu cầu sử dụng điện cao).
*   Nếu `custom_fields.roof_area` > `100` m2 $\rightarrow$ **+20 điểm** (Diện tích mái lớn).
*   Nếu `phone_number` is `NOT_EMPTY` $\rightarrow$ **+30 điểm** (Khách hàng sẵn sàng cung cấp SĐT để tư vấn).
*   Nếu `location` = `Đồng Nai` (Khu vực trọng điểm lắp đặt của Solavie) $\rightarrow$ **+20 điểm**.

Mỗi khi khách hàng có cập nhật thông tin, công cụ tính điểm sẽ tính toán lại cột `lead_score` và cập nhật phân loại mức độ (`COLD`, `WARM`, `HOT`) ngay lập tức.

---

## 3. Thiết Kế Quản Lý Trạng Thái & Tiến Độ Động (Dynamic Stages & Progress)

Hệ thống cho phép Admin Solavie tự định nghĩa quy trình bán hàng (Sales Pipeline) thay vì fix cứng trong mã nguồn bằng cách cấu hình bảng **`crm_stages`**:

### 3.1. Bảng `crm_stages` (Quản lý trạng thái & tiến độ động)
| Tên Trường | Kiểu Dữ Liệu | Ràng Buộc | Mô Tả |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Định danh trạng thái |
| `code` | VARCHAR(50) | UNIQUE, NOT NULL | Khóa kỹ thuật (ví dụ: `NEW`, `AI_QUALIFIED`, `CONTACTED`, `SURVEYED`, `CONTRACTED`) |
| `name` | VARCHAR(100) | NOT NULL | Tên hiển thị trên UI (ví dụ: "AI Đã Xác Thực") |
| `progress_percentage`| INTEGER | NOT NULL | Tiến độ hoàn thành tương ứng (ví dụ: `10%`, `30%`, `100%`) |
| `sort_order` | INTEGER | NOT NULL | Thứ tự sắp xếp trên Kanban Board |
| `is_system` | BOOLEAN | Default FALSE | Nếu là TRUE, trạng thái này do hệ thống tự gán (như `NEW`, `AI_QUALIFIED`). Nếu là FALSE, do Sales chuyển đổi thủ công. |

### 3.2. Quản Lý Tiến Độ Theo Trạng Thái Động
Khi nhân viên kéo/thả khách hàng qua các cột trên Kanban board, hệ thống sẽ thực hiện các logic sau:
1.  Cập nhật `stage_id` của khách hàng.
2.  Lấy thông tin `progress_percentage` của `stage` mới để cập nhật tiến độ tổng thể của khách hàng đó.
3.  Tự động ghi log hoạt động vào bảng `crm_activities` để theo dõi lịch sử chuyển trạng thái.

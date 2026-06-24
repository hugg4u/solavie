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

---

## 4. Thiết Kế Cơ Chế Gộp Hồ Sơ Tối Ưu (Merge Profile Mechanism)

Khi khách hàng tương tác qua nhiều kênh (Facebook Messenger và Zalo OA), hệ thống ban đầu sẽ khởi tạo các hồ sơ độc lập dựa trên định danh MXH (`facebook_psid`, `zalo_user_id`). Khi AI Chatbot hoặc nhân viên trích xuất được số điện thoại thực tế của khách hàng, hệ thống sẽ tự động kích hoạt cơ chế gộp hồ sơ trùng số điện thoại (`Merge Profile`) để hợp nhất dữ liệu về một mối duy nhất.

### 4.1. Quy Trình Kích Hoạt & Khóa Phân Tán (Distributed Lock)

Khi có sự kiện cập nhật số điện thoại cho khách hàng:
1.  `MergeProfileService` cố gắng chiếm khóa phân tán Redis `lock:merge:phone:${phone}` với TTL 10 giây. Nếu không lấy được khóa (do luồng webhook khác đang thực hiện gộp cho chính số điện thoại này), hệ thống sẽ từ chối xử lý và đưa job vào hàng đợi thử lại (Retry Queue) sau 2 giây.
2.  Tìm kiếm tất cả các bản ghi trong bảng `crm_customers` trùng số điện thoại `${phone}`.
3.  Nếu phát hiện từ 2 hồ sơ trở lên trùng số điện thoại, tiến hành quy trình hợp nhất.

```
[Webhook Facebook] ──> Cập nhật SĐT ──> [MergeProfileService] ──> Chiếm lock Redis thành công?
[Webhook Zalo]     ──> Cập nhật SĐT ──> [Đợi chiếm lock...]              │
                                                                         ▼
                                                              [Xác định Primary Profile]
                                                                         │
                                                                         ▼
                                                               [Gộp định danh Zalo/FB]
                                                                         │
                                                                         ▼
                                                              [Hợp nhất Conversations]
                                                                         │
                                                                         ▼
                                                             [Giải quyết xung đột Custom fields]
                                                                         │
                                                                         ▼
                                                            [Giải phóng lock & Soft delete phụ]
```

### 4.2. Thuật Toán Xác Định Hồ Sơ Chính (Primary Profile)

Hệ thống chấm điểm 2 hồ sơ trùng lặp để chọn ra hồ sơ chính (`Primary Profile`) và hồ sơ phụ (`Secondary Profile`):
-   **Tiêu chí 1: Người tiếp quản.** Hồ sơ đã được phân công cho nhân viên Sales (`assignee_id IS NOT NULL`) được ưu tiên làm hồ sơ chính.
-   **Tiêu chí 2: Mức độ hoàn thiện dữ liệu.** Hồ sơ có nhiều trường nhu cầu Solar trong `custom_fields` hơn sẽ được ưu tiên.
-   **Tiêu chí 3: Thời điểm tạo.** Nếu hai tiêu chí trên tương đương, hồ sơ có `created_at` nhỏ hơn (tạo trước) sẽ được chọn làm hồ sơ chính.

Hồ sơ còn lại được xác định là hồ sơ phụ (`Secondary Profile`).

### 4.3. Giải Quyết Xung Đột Thuộc Tính Nhu Cầu Solar (Data Conflict Resolution)

Để tránh mất dữ liệu lịch sử quan trọng của khách hàng khi gộp, hệ thống áp dụng nguyên tắc:
1.  **Hợp nhất mảng/JSON:** Các trường trong `custom_fields` và `roi_estimation` sẽ được gộp chung. Nếu cùng một khóa thuộc tính động (VD: `monthly_bill` - tiền điện) có giá trị khác nhau:
    -   Ưu tiên giữ lại giá trị của hồ sơ có thời gian cập nhật mới nhất (`updated_at`).
    -   Tất cả các giá trị cũ của hồ sơ phụ sẽ được tự động chuyển đổi thành một bản ghi ghi chú mới (bảng `crm_customer_notes`) đính kèm vào hồ sơ chính với định dạng JSON:
        ```json
        {
          "type": "profile_merge_snapshot",
          "secondary_customer_id": "uuid-phu-123",
          "merged_fields": {
            "monthly_bill": "2,500,000đ",
            "roof_area": "80m2"
          },
          "note": "Hồ sơ được tự động gộp từ tài khoản Zalo OA vào ngày 2026-06-24."
        }
        ```
2.  **Hợp nhất Định Danh Mạng Xã Hội:** Cột `facebook_psid` và `zalo_user_id` của hồ sơ phụ sẽ được chuyển sang cập nhật vào hồ sơ chính.

### 4.4. Hợp Nhất Phiên Hội Thoại & Dòng Hoạt Động (Conversations & Activity Merge)

Sau khi xác định hồ sơ chính và phụ:
1.  Backend cập nhật cột `customer_id` trong bảng `chat_conversations` của tất cả các cuộc hội thoại thuộc hồ sơ phụ trỏ về hồ sơ chính. Điều này giúp nhân viên Sales xem được toàn bộ lịch sử trò chuyện trên mọi kênh của khách hàng ngay trên một dòng thời gian Inbox duy nhất.
2.  Cập nhật cột `customer_id` trong bảng `crm_activities` từ hồ sơ phụ sang hồ sơ chính.
3.  Thực hiện **Soft-delete (hoặc Hard-delete)** hồ sơ phụ trong bảng `crm_customers` bằng cách đánh dấu trạng thái xóa hoặc cập nhật `phone_number` thành `NULL` kèm hậu tố `_merged` để giải phóng index unique.
4.  Bắn sự kiện Outbox `crm.profile.merged` chứa payload `{ primary_customer_id, secondary_customer_id }`.
5.  Gateway WebSocket lắng nghe sự kiện này và gửi tín hiệu cập nhật thời gian thực đến trình duyệt của Sales Rep để tự động tải lại danh sách khách hàng và hội thoại mà không cần F5.


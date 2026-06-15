# Đặc Tả Business Logic Module CRM

## 1. Thuật Toán Tính Toán ROI Solar
Tự động tính toán khi khách hàng cung cấp diện tích mái và hóa đơn tiền điện.

### Công thức:
1. **Công suất tối đa (mái tôn):** `P_max = Diện tích mái / 6` (kWp)
2. **Công suất mục tiêu (theo tiền điện):**
   - Lượng điện tiêu thụ 1 tháng = `Tiền điện / 2700 VNĐ`
   - `P_target = (Điện 1 tháng) / (Giờ nắng * 0.8 * 30)`
3. **Công suất đề xuất:** `P = min(P_max, P_target)`
4. **Chi phí đầu tư:** `P * 14,000,000 VNĐ`
5. **Tiền tiết kiệm 1 năm:** `P * Giờ nắng * 0.8 * 365 * 2700`
6. **Thời gian hoàn vốn (ROI):** `Chi phí đầu tư / Tiền tiết kiệm 1 năm`

## 2. Thuật Toán Gộp Hồ Sơ (Merge Profiles)
Khi hệ thống bắt được Event `customer.created` hoặc tin nhắn mới, sẽ check số điện thoại:
- Nếu trùng: Gộp dữ liệu theo quy tắc:
  - Thông tin bị khuyết ở Primary sẽ lấy từ Secondary đắp vào.
  - Thông tin xung đột: Giữ thông tin của Secondary (mới nhất), đẩy thông tin cũ vào Note (`crm_activities`).
  - Trỏ ID Messenger/Zalo của Secondary về Primary.
  - Soft-delete Secondary.

## 3. Dynamic Pipeline Constraint (Ràng buộc kéo thả)
- Khi Sales gọi API `PATCH /api/v1/crm/customers/:id/stage` để chuyển từ Stage A sang Stage B.
- Hệ thống query bảng `crm_stages` để lấy danh sách `required_fields` của Stage B.
- Duyệt qua `custom_fields` của khách hàng. Nếu thiếu bất kỳ field nào trong `required_fields` -> Throw Exception HTTP 400.

## 4. Dynamic Lead Scoring
- Mỗi khi `custom_fields` hoặc thuộc tính chính bị thay đổi, Trigger hàm `recalculateScore(customerId)`.
- Duyệt qua toàn bộ `crm_scoring_rules` có `is_active = true`.
- Thực thi Eval Logic tương ứng. Cộng dồn tổng điểm vào `lead_score`.
- Cập nhật `lead_temperature`:
  - `< 40`: COLD
  - `40 - 70`: WARM
  - `> 70`: HOT
- Nếu trạng thái vừa đổi thành HOT, phát Event `crm.lead.hot` để bắn thông báo.

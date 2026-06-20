export interface ResourceHydrator {
  /**
   * Tải tài nguyên từ Database lên RAM dựa trên ID của tài nguyên.
   * Chỉ select các trường thực sự cần thiết cho việc đánh giá ABAC.
   * 
   * @param resourceId Định danh của tài nguyên cần tải (UUID hoặc string)
   * @returns Đối tượng chứa các thuộc tính cần thiết cho ABAC, hoặc null nếu không tìm thấy.
   */
  fetchResource(resourceId: string): Promise<Record<string, any> | null>;
}

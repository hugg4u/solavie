# Thiết Kế Kiến Trúc Module IAM (Design)

## 1. Mẫu Thiết Kế (Design Patterns)
- **Guard Pattern (NestJS)**: Xây dựng các RolesGuard và PermissionsGuard chắn trước mọi API Endpoints.
- **Decorator Pattern**: Đánh dấu các API Endpoint bằng custom decorators (e.g. `@RequirePermissions('lead:read')`).

## 2. Thiết Kế Database (Lược Đồ Quan Hệ)

### 2.1. Bảng `iam_users` (Nhân Viên)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `email` | VARCHAR(255) | Username |
| `password_hash` | VARCHAR(255) | Bcrypt hash |
| `full_name` | VARCHAR(255) | |
| `is_active` | BOOLEAN | |

### 2.2. Bảng `iam_roles` (Vai Trò)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `name` | VARCHAR(50) | `ADMIN`, `SALES` |
| `description` | TEXT | |

### 2.3. Bảng `iam_permissions` (Quyền Chi Tiết)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `action` | VARCHAR(100) | Định dạng resource:action (e.g. `lead:create`) |
| `description` | TEXT | |

### 2.4. Bảng `iam_policies` (ABAC Policies)
| Tên Trường | Kiểu Dữ Liệu | Mô Tả |
| --- | --- | --- |
| `id` | UUID (PK) | |
| `name` | VARCHAR(100) | Tên policy |
| `rule_expression` | TEXT | Biểu thức điều kiện (`user.id == resource.assignee_id`) |

### 2.5. Các bảng nối (Junction tables)
- `iam_user_roles`: Nối User và Role.
- `iam_role_permissions`: Nối Role và Permission.

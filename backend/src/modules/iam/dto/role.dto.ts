import {
  IsString,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsUUID,
  IsObject,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../core/dto/pagination.dto';

export class CreateRoleDto {
  @ApiProperty({
    example: 'SALES_LEAD',
    description: 'Mã vai trò viết hoa không dấu, ngăn cách bằng dấu gạch dưới',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'Role code must contain only uppercase letters, numbers, and underscores',
  })
  code: string;

  @ApiProperty({
    example: 'Trưởng Nhóm Kinh Doanh',
    description: 'Tên vai trò hiển thị',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'Quản lý nhóm kinh doanh và duyệt báo giá',
    description: 'Mô tả vai trò',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    example: ['17f7abc6-4e04-4dee-b1a1-5172d9db3ee2'],
    description: 'Danh sách ID của các Permission cần gán ngay khi tạo',
    required: false,
  })
  @IsUUID(undefined, { each: true })
  @IsOptional()
  permissionIds?: string[];
}

export class UpdateRoleDto {
  @ApiProperty({
    example: 'Trưởng Nhóm Kinh Doanh Cấp Cao',
    description: 'Tên vai trò hiển thị',
    required: false,
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  name?: string;

  @ApiProperty({
    example: 'Mô tả cập nhật...',
    description: 'Mô tả vai trò',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;
}

export class AssignPolicyDto {
  @ApiProperty({
    example: 'uuid-permission-id',
    description: 'ID của Permission cần gán',
  })
  @IsUUID()
  @IsNotEmpty()
  permissionId: string;

  @ApiProperty({
    example: { '==': [{ var: 'user.id' }, { var: 'resource.assigneeId' }] },
    description:
      'Biểu thức quy tắc logic ABAC (json-logic-js). Để trống/null nếu là quyền tĩnh (RBAC).',
    required: false,
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  ruleExpression?: Record<string, any> | null;
}

export class RoleListQueryDto extends PaginationQueryDto {
  @ApiProperty({
    description: 'Tìm kiếm từ khóa theo mã code, name hoặc description',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'Sắp xếp theo cột (code, name, createdAt)',
    default: 'code',
    required: false,
  })
  @IsOptional()
  @IsString()
  sort?: string = 'code';

  @ApiProperty({
    description: 'Hướng sắp xếp (ASC, DESC)',
    default: 'ASC',
    required: false,
  })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC' = 'ASC';
}

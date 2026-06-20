import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../core/dto/pagination.dto';

export class PermissionListQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'Tìm kiếm từ khóa theo mã action hoặc mô tả permission', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Sắp xếp theo cột (action, createdAt)', default: 'action', required: false })
  @IsOptional()
  @IsString()
  sort?: string = 'action';

  @ApiProperty({ description: 'Hướng sắp xếp (ASC, DESC)', default: 'ASC', required: false })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC' = 'ASC';
}

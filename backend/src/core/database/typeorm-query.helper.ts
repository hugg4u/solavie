import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { PaginationQueryDto } from '../dto/pagination.dto';
import { BadRequestException } from '@nestjs/common';

export interface QueryHelperOptions {
  alias: string;               // Alias của bảng chính trong query (ví dụ: 'user')
  searchFields?: string[];     // Các trường văn bản cần áp dụng tìm kiếm (ví dụ: ['user.fullName', 'user.email'])
  filterableFields?: string[]; // Các trường hỗ trợ lọc chính xác bằng dấu bằng (ví dụ: ['isActive'])
}

export class TypeOrmQueryHelper {
  static apply<T extends ObjectLiteral>(
    queryBuilder: SelectQueryBuilder<T>,
    queryDto: PaginationQueryDto & { search?: string; sort?: string; order?: string },
    options: QueryHelperOptions,
  ): void {
    const alias = options.alias;

    // 1. Áp dụng Tìm kiếm (Search) - Không phân biệt hoa thường
    if (queryDto.search && options.searchFields && options.searchFields.length > 0) {
      const conditions = options.searchFields
        .map((field) => `LOWER(${field}) LIKE LOWER(:search)`)
        .join(' OR ');
      queryBuilder.andWhere(`(${conditions})`, { search: `%${queryDto.search.trim()}%` });
    }

    // 2. Áp dụng Bộ lọc chính xác (Filter)
    if (options.filterableFields) {
      options.filterableFields.forEach((field) => {
        const val = (queryDto as any)[field];
        if (val !== undefined && val !== null && val !== '') {
          // Cast boolean dạng chuỗi từ query string
          const castedVal = val === 'true' ? true : val === 'false' ? false : val;
          queryBuilder.andWhere(`${alias}.${field} = :${field}`, { [field]: castedVal });
        }
      });
    }

    // 3. Sắp xếp động (Sorting) - Đi kèm chốt chặn bảo mật SQL Injection
    if (queryDto.sort) {
      const isSafeColumn = /^[a-zA-Z0-9_]+$/.test(queryDto.sort);
      if (!isSafeColumn) {
        throw new BadRequestException('Invalid sort column name');
      }
      const order = queryDto.order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      queryBuilder.orderBy(`${alias}.${queryDto.sort}`, order);
    }

    // 4. Phân trang (Pagination)
    const limit = queryDto.limit || 20;
    const page = queryDto.page || 1;
    const skip = (page - 1) * limit;

    queryBuilder.skip(skip).take(limit);
  }
}

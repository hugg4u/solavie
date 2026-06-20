import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionEntity } from '../../entities/permission.entity';
import { RequirePermissions } from '../../decorators/permissions.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionListQueryDto } from '../../dto/permission.dto';
import { PaginatedResponseDto } from '../../../../core/dto/pagination.dto';
import { TypeOrmQueryHelper } from '../../../../core/database/typeorm-query.helper';

@ApiTags('IAM Permissions')
@ApiBearerAuth()
@Controller({
  path: 'iam/permissions',
  version: '1',
})
export class PermissionsController {
  constructor(
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
  ) {}

  @Get()
  @RequirePermissions('iam.permissions.read')
  async findAll(
    @Query() query: PermissionListQueryDto,
  ): Promise<PaginatedResponseDto<PermissionEntity>> {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const dbQuery = this.permissionRepo.createQueryBuilder('permission');

    TypeOrmQueryHelper.apply(dbQuery, query, {
      alias: 'permission',
      searchFields: ['permission.action', 'permission.description'],
    });

    if (!query.sort) {
      dbQuery.orderBy('permission.action', 'ASC');
    }

    const [data, total] = await dbQuery.getManyAndCount();
    return new PaginatedResponseDto(data, total, page, limit);
  }
}

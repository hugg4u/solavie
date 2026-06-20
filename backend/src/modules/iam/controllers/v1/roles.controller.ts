import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { RoleService } from '../../services/role.service';
import { RequirePermissions } from '../../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../../interfaces/request.interface';
import { CreateRoleDto, UpdateRoleDto, AssignPolicyDto, RoleListQueryDto } from '../../dto/role.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('IAM Roles')
@ApiBearerAuth()
@Controller({
  path: 'iam/roles',
  version: '1',
})
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions('iam.roles.read')
  async findAll(@Query() query: RoleListQueryDto) {
    return this.roleService.findAllRoles(query);
  }

  @Get(':code')
  @RequirePermissions('iam.roles.read')
  async findOne(@Param('code') code: string) {
    return this.roleService.findRoleByCode(code);
  }

  @Post()
  @RequirePermissions('iam.roles.create')
  async create(@Body() dto: CreateRoleDto) {
    const role = await this.roleService.createRole(dto.code, dto.name, dto.description, dto.permissionIds);
    return {
      message: 'Role created successfully',
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  @Patch(':code')
  @RequirePermissions('iam.roles.update')
  async update(@Param('code') code: string, @Body() dto: UpdateRoleDto) {
    const role = await this.roleService.updateRole(code, dto.name, dto.description);
    return {
      message: `Role ${code} updated successfully`,
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  @Delete(':code')
  @RequirePermissions('iam.roles.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('code') code: string) {
    await this.roleService.deleteRole(code);
  }

  @Post(':roleCode/policies')
  @RequirePermissions('iam.roles.update')
  async assignPolicy(
    @Param('roleCode') roleCode: string,
    @Body() dto: AssignPolicyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId) throw new UnauthorizedException('Admin ID not found in token');
    const adminIp = req.ip || req.raw?.socket?.remoteAddress || 'unknown';

    await this.roleService.assignPolicyToRole(
      roleCode,
      dto.permissionId,
      dto.ruleExpression || null,
      adminId,
      adminIp,
    );

    return {
      message: `Policy successfully mapped to role ${roleCode}`,
    };
  }

  @Delete(':roleCode/policies/:permissionId')
  @RequirePermissions('iam.roles.update')
  async removePolicy(
    @Param('roleCode') roleCode: string,
    @Param('permissionId', new ParseUUIDPipe()) permissionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId) throw new UnauthorizedException('Admin ID not found in token');
    const adminIp = req.ip || req.raw?.socket?.remoteAddress || 'unknown';

    await this.roleService.removePolicyFromRole(roleCode, permissionId, adminId, adminIp);

    return {
      message: `Policy successfully removed from role ${roleCode}`,
    };
  }

  // ABSOLUTE ROUTING FOR USER-ROLE ASSIGNMENT (Tương thích ngược 100%)
  
  @Post('/iam/users/:userId/roles/:roleCode')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('iam.roles.assign')
  async assignRoleToUser(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId) throw new UnauthorizedException('Admin ID not found in token');
    const adminIp = req.ip || req.raw?.socket?.remoteAddress || 'unknown';

    await this.roleService.assignRole(userId, roleCode, adminId, adminIp);
    return {
      message: `Role ${roleCode} assigned successfully to user ${userId}`,
    };
  }

  @Delete('/iam/users/:userId/roles/:roleCode')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('iam.roles.remove')
  async removeRoleFromUser(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId) throw new UnauthorizedException('Admin ID not found in token');
    const adminIp = req.ip || req.raw?.socket?.remoteAddress || 'unknown';

    await this.roleService.removeRole(userId, roleCode, adminId, adminIp);
    return {
      message: `Role ${roleCode} removed successfully from user ${userId}`,
    };
  }
}

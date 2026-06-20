import {
  Controller,
  Post,
  Delete,
  Param,
  Req,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { RoleService } from '../../services/role.service';
import { RequirePermissions } from '../../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../../interfaces/request.interface';

@Controller({
  path: 'iam/users/:userId/roles',
  version: '1',
})
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Post(':roleCode')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('iam.roles.assign')
  async assignRole(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId)
      throw new UnauthorizedException('Admin ID not found in token');

    const rawReq = req.raw;
    const adminIp = req.ip || rawReq.socket?.remoteAddress || 'unknown';
    await this.roleService.assignRole(userId, roleCode, adminId, adminIp);
    return {
      message: `Role ${roleCode} assigned successfully to user ${userId}`,
    };
  }

  @Delete(':roleCode')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('iam.roles.remove')
  async removeRole(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('roleCode') roleCode: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId)
      throw new UnauthorizedException('Admin ID not found in token');

    const rawReq = req.raw;
    const adminIp = req.ip || rawReq.socket?.remoteAddress || 'unknown';
    await this.roleService.removeRole(userId, roleCode, adminId, adminIp);
    return {
      message: `Role ${roleCode} removed successfully from user ${userId}`,
    };
  }
}

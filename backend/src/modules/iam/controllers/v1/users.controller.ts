import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Req,
  Query,
  UnauthorizedException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UsersService } from '../../services/users.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserListQueryDto,
} from '../../dto/user.dto';
import { RequirePermissions } from '../../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../../interfaces/request.interface';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('IAM Users')
@ApiBearerAuth()
@Controller({
  path: 'iam/users',
  version: '1',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('iam.users.read')
  async findAll(@Query() query: UserListQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('iam.users.read')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @RequirePermissions('iam.users.create')
  async createUser(
    @Body() dto: CreateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId)
      throw new UnauthorizedException('Admin ID not found in token');

    const user = await this.usersService.createUser(dto, adminId);
    return {
      message: 'User created successfully. Activation email is being sent.',
      userId: user.id,
    };
  }

  @Patch(':id')
  @RequirePermissions('iam.users.update')
  async updateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const adminId = req.user?.id;
    if (!adminId)
      throw new UnauthorizedException('Admin ID not found in token');

    const rawReq = req.raw;
    const adminIp = req.ip || rawReq.socket?.remoteAddress || 'unknown';
    const user = await this.usersService.updateUser(id, dto, adminId, adminIp);
    return {
      message: 'User updated successfully.',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isActive: user.isActive,
      },
    };
  }

  @Post(':id/resend-activation')
  @RequirePermissions('iam.users.update')
  async resendActivation(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const adminId = req.user?.id;
    if (!adminId)
      throw new UnauthorizedException('Admin ID not found in token');

    await this.usersService.resendActivation(id, adminId);
    return {
      message: 'Activation email resend triggered successfully.',
    };
  }

  @Post(':id/reset-password')
  @RequirePermissions('iam.users.update')
  async resetPassword(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const adminId = req.user?.id;
    if (!adminId)
      throw new UnauthorizedException('Admin ID not found in token');

    await this.usersService.resetPassword(id, adminId);
    return {
      message: 'Password reset initiated successfully. User sessions revoked and reset link email is being sent.',
    };
  }
}

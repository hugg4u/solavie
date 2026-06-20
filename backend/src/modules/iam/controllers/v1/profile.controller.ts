import {
  Controller,
  Patch,
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ProfileService } from '../../services/profile.service';
import { UpdateProfileDto, ChangePasswordDto } from '../../dto/profile.dto';
import type { AuthenticatedRequest } from '../../interfaces/request.interface';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('IAM Profile')
@ApiBearerAuth()
@Controller({
  path: 'iam/users/me',
  version: '1',
})
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  async getProfile(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User ID not found in token');
    return this.profileService.getProfile(userId);
  }

  @Patch('profile')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User ID not found in token');
    const user = await this.profileService.updateProfile(userId, dto);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
    };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User ID not found in token');

    const rawReq = req.raw;
    const ipAddress = req.ip || rawReq.socket?.remoteAddress || 'unknown';
    const userAgentRaw = req.headers['user-agent'] as
      | string
      | string[]
      | undefined;
    const userAgent = Array.isArray(userAgentRaw)
      ? userAgentRaw[0]
      : userAgentRaw || 'unknown';

    await this.profileService.changePassword(userId, dto, ipAddress, userAgent);

    return {
      message:
        'Password changed successfully. All other sessions have been revoked.',
    };
  }
}

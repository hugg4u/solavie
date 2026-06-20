import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { AuthService } from '../../services/auth.service';
import { LoginDto } from '../../dto/auth.dto';
import {
  ExchangeActivationTokenDto,
  ActivateUserDto,
} from '../../dto/user.dto';
import { IsPublic } from '../../decorators/public.decorator';
import { IamCookies } from '../../constants/iam.constants';

@Controller({
  path: 'iam/auth',
  version: '1',
})
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @IsPublic()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const ipAddress = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';

    const result = await this.authService.login(loginDto, ipAddress, userAgent);
    const refreshMaxAgeStr = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    const refreshMaxAge = refreshMaxAgeStr
      ? parseInt(refreshMaxAgeStr, 10) * 1000
      : 604800000;

    res.setCookie(IamCookies.REFRESH_TOKEN, result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/iam/auth',
      maxAge: refreshMaxAge,
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  @IsPublic()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const refreshToken = req.cookies[IamCookies.REFRESH_TOKEN];
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const result = await this.authService.refresh(refreshToken);
    const refreshMaxAgeStr = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    const refreshMaxAge = refreshMaxAgeStr
      ? parseInt(refreshMaxAgeStr, 10) * 1000
      : 604800000;

    res.setCookie(IamCookies.REFRESH_TOKEN, result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/iam/auth',
      maxAge: refreshMaxAge,
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const refreshToken = req.cookies[IamCookies.REFRESH_TOKEN];

    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }

    res.setCookie(IamCookies.REFRESH_TOKEN, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/iam/auth',
      maxAge: 0,
    });

    return { message: 'Logged out successfully' };
  }

  @IsPublic()
  @Post('exchange-activation-token')
  @HttpCode(HttpStatus.OK)
  async exchangeActivationToken(
    @Body() dto: ExchangeActivationTokenDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.authService.exchangeActivationToken(
      dto.email,
      dto.token,
    );

    const setupCookieMaxAge =
      this.configService.get<number>('JWT_SETUP_COOKIE_MAX_AGE_MS') ||
      15 * 60 * 1000;

    res.setCookie(IamCookies.SETUP_TOKEN, result.setupToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/iam/auth/activate',
      maxAge: setupCookieMaxAge,
    });

    return {
      userId: result.userId,
      email: result.email,
      fullName: result.fullName,
    };
  }

  @IsPublic()
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Body() dto: ActivateUserDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const setupToken = req.cookies[IamCookies.SETUP_TOKEN];
    if (!setupToken) {
      throw new UnauthorizedException('Setup token missing in cookies');
    }

    const ipAddress = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = (req.headers['user-agent'] as string) || 'unknown';

    const result = await this.authService.activateUser(
      setupToken,
      dto.password,
      ipAddress,
      userAgent,
    );

    // Xoá cookie setup_token sau khi thành công
    res.setCookie(IamCookies.SETUP_TOKEN, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/iam/auth/activate',
      maxAge: 0,
    });

    const refreshMaxAgeStr = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    const refreshMaxAge = refreshMaxAgeStr
      ? parseInt(refreshMaxAgeStr, 10) * 1000
      : 604800000;

    res.setCookie(IamCookies.REFRESH_TOKEN, result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/iam/auth',
      maxAge: refreshMaxAge,
    });

    return {
      message: 'Account activated successfully',
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }
}

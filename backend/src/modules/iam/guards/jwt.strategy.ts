import { Injectable, Inject, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { UserEntity } from '../entities/user.entity';
import { IamStrategies } from '../constants/iam.constants';
import { REDIS_CACHE_CLIENT } from '../../../core/redis/redis.module';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, IamStrategies.JWT) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @Inject(REDIS_CACHE_CLIENT)
    private readonly redisClient: Redis,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    const userId = payload.sub;
    const cacheKey = `iam:user_active:${userId}`;

    let isActiveStr: string | null = null;
    try {
      isActiveStr = await this.redisClient.get(cacheKey);
    } catch {
      // Fallback to DB on Redis error
    }

    if (isActiveStr !== null) {
      if (isActiveStr === 'false') {
        throw new UnauthorizedException('Account is disabled');
      }
      return { id: userId, email: payload.email };
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, isActive: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    try {
      await this.redisClient.set(
        cacheKey,
        user.isActive ? 'true' : 'false',
        'EX',
        300,
      );
    } catch {
      // Ignore Redis write error
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    return { id: userId, email: payload.email };
  }
}

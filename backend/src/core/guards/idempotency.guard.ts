import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { REDIS_CACHE_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyGuard implements CanActivate {
  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'];

    // Nếu API cấu hình bắt buộc mà không có, ta ném lỗi. Ở mức global, nếu ko có thì bỏ qua.
    if (!idempotencyKey) {
      return true;
    }

    // Chỉ áp dụng cho các hàm làm thay đổi dữ liệu
    if (['GET', 'OPTIONS', 'HEAD'].includes(request.method)) {
      return true;
    }

    const redisKey = `idempotency:${idempotencyKey}`;
    // Cố gắng set giá trị, TTL = 24h = 86400s
    // SETNX trả về 1 nếu set thành công, 0 nếu key đã tồn tại
    const result = await this.redis.set(redisKey, 'LOCKED', 'EX', 86400, 'NX');

    if (result !== 'OK') {
      // Key đã tồn tại -> request trùng lặp
      throw new HttpException(
        'Duplicate request detected. Please try again later or check your request.',
        HttpStatus.CONFLICT,
      );
    }

    return true;
  }
}

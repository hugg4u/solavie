import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest, FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { REDIS_CACHE_CLIENT } from '../redis/redis.module';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();
    const idempotencyKeyRaw = request.headers['x-idempotency-key'];
    const idempotencyKey = Array.isArray(idempotencyKeyRaw)
      ? idempotencyKeyRaw[0]
      : idempotencyKeyRaw;

    // 1. Bypass if no idempotency key is present or it's a read method
    if (
      !idempotencyKey ||
      ['GET', 'OPTIONS', 'HEAD'].includes(request.method)
    ) {
      return next.handle();
    }

    const redisKey = `core:idempotency:${idempotencyKey}`;
    const ttl = this.configService.get<number>('IDEMPOTENCY_TTL_SEC') || 86400;

    // 2. Check lock or cached response in Redis
    const cached = await this.redis.get(redisKey);

    if (cached === 'PROCESSING') {
      this.logger.warn(
        `Duplicate request in progress detected for key: ${idempotencyKey}`,
      );
      throw new HttpException(
        'Duplicate request in progress. Please try again later.',
        HttpStatus.CONFLICT,
      );
    }

    if (cached) {
      this.logger.log(
        `Serving cached response for idempotency key: ${idempotencyKey}`,
      );
      try {
        const { statusCode, body } = JSON.parse(cached) as {
          statusCode: number;
          body: unknown;
        };
        response.status(statusCode);
        return of(body);
      } catch (err) {
        this.logger.error(
          `Failed to parse cached response for key: ${idempotencyKey}`,
          err,
        );
        // Fallback: If parse fails, treat as not exists and re-execute
      }
    }

    // 3. Acquire temporary lock
    const acquired = await this.redis.set(
      redisKey,
      'PROCESSING',
      'EX',
      ttl,
      'NX',
    );

    if (acquired !== 'OK') {
      // Re-fetch to handle potential race condition if job finished just now
      const doubleCheck = await this.redis.get(redisKey);
      if (doubleCheck && doubleCheck !== 'PROCESSING') {
        try {
          const { statusCode, body } = JSON.parse(doubleCheck) as {
            statusCode: number;
            body: unknown;
          };
          response.status(statusCode);
          return of(body);
        } catch (err) {
          this.logger.error(
            `Failed to parse cached response on double check for key: ${idempotencyKey}`,
            err,
          );
        }
      }
      throw new HttpException(
        'Duplicate request in progress. Please try again later.',
        HttpStatus.CONFLICT,
      );
    }

    // 4. Proceed with pipeline execution, cache response on success, delete key on failure
    return next.handle().pipe(
      tap((result: unknown) => {
        const statusCode = response.statusCode || 200;
        const cachePayload = JSON.stringify({
          statusCode,
          body: result,
        });
        this.redis.set(redisKey, cachePayload, 'EX', ttl).catch((err) => {
          this.logger.error(
            `Failed to cache response for idempotency key: ${idempotencyKey}`,
            err,
          );
        });
      }),
      catchError((error: unknown) => {
        this.logger.warn(
          `Request failed for idempotency key: ${idempotencyKey}. Releasing lock.`,
        );
        this.redis.del(redisKey).catch((err) => {
          this.logger.error(
            `Failed to release lock for idempotency key: ${idempotencyKey}`,
            err,
          );
        });
        return throwError(() => error);
      }),
    );
  }
}

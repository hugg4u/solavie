import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

export const SKIP_TRANSFORM_KEY = 'skipTransform';
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);

interface CustomResponse {
  getHeader?: (name: string) => string | string[] | number | undefined;
  sent?: boolean;
  headersSent?: boolean;
  statusCode?: number;
}

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isSkipTransform = this.reflector.getAllAndOverride<boolean>(
      SKIP_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isSkipTransform) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const response = http.getResponse<unknown>();
    const request = http.getRequest<unknown>();

    const requestRecord = request as Record<string, unknown>;
    const traceId = (requestRecord.traceId as string) || 'unknown';

    const res = response as CustomResponse;

    // 1. Pre-handler auto-bypass checks
    if (res.getHeader) {
      const contentTypeRaw = res.getHeader('content-type');
      const contentType =
        typeof contentTypeRaw === 'string' ? contentTypeRaw : '';

      const contentDispositionRaw = res.getHeader('content-disposition');
      const contentDisposition =
        typeof contentDispositionRaw === 'string' ? contentDispositionRaw : '';

      // Bypass if the route serves files, streams, or non-JSON payloads
      if (
        (contentType && !contentType.includes('application/json')) ||
        contentDisposition.includes('attachment')
      ) {
        return next.handle();
      }
    }

    return next.handle().pipe(
      map((result: unknown) => {
        // 2. Post-handler checks: bypass if response has already been sent (Fastify/Express manual handling)
        if (res.sent || res.headersSent) {
          return result;
        }

        const statusCode = res.statusCode || 200;

        // 3. Bypass redirect statuses (3xx)
        if (statusCode >= 300 && statusCode < 400) {
          return result;
        }

        let message = 'Request successful';
        let errorCode: string | null = null;
        let data: unknown = result;

        // 4. Handle Paginated Response Abstraction
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          const resObj = result as Record<string, unknown>;
          if ('data' in resObj && 'meta' in resObj) {
            return {
              statusCode,
              timestamp: new Date().toISOString(),
              traceId,
              errorCode: (resObj.errorCode as string) || null,
              message: (resObj.message as string) || message,
              data: resObj.data,
              meta: resObj.meta,
            };
          }
        }

        // 5. Handle Custom success messages embedded in returned objects
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          const resObj = result as Record<string, unknown>;
          errorCode = (resObj.errorCode as string) || null;
          if (resObj.message && typeof resObj.message === 'string') {
            message = resObj.message;
            const keysCount = Object.keys(resObj).length;
            const hasMsg = 'message' in resObj;
            const hasCode = 'errorCode' in resObj;

            if (keysCount === 1 && hasMsg) {
              data = null;
            } else if (keysCount === 2 && hasMsg && hasCode) {
              data = null;
            } else {
              const rest = { ...resObj };
              delete rest.message;
              delete rest.errorCode;
              data = rest;
            }
          }
        }

        // 6. Standard successful response wrapping
        return {
          statusCode,
          timestamp: new Date().toISOString(),
          traceId,
          errorCode,
          message,
          data,
        };
      }),
    );
  }
}

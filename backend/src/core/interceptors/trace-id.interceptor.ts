import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { traceId?: string }>();
    const response = context
      .switchToHttp()
      .getResponse<
        FastifyReply & { setHeader?: (name: string, value: string) => void }
      >();

    const traceIdHeader = request.headers['x-trace-id'];
    const traceId =
      (Array.isArray(traceIdHeader) ? traceIdHeader[0] : traceIdHeader) ||
      uuidv4();
    request.traceId = traceId;

    // Gắn traceId ngược lại vào Response Header để Client dễ dàng debug (Fastify & Express)
    if (typeof response.header === 'function') {
      response.header('x-trace-id', traceId); // Fastify
    } else if (typeof response.setHeader === 'function') {
      response.setHeader('x-trace-id', traceId); // Express fallback
    }

    return next.handle();
  }
}

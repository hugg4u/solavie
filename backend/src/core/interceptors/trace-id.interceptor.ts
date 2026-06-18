/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const traceId = request.headers['x-trace-id'] || uuidv4();
    request.traceId = traceId;

    // Gắn traceId ngược lại vào Response Header để Client dễ dàng debug (Fastify & Express)
    if (response.header) {
      response.header('x-trace-id', traceId); // Fastify
    } else if (response.setHeader) {
      response.setHeader('x-trace-id', traceId); // Express fallback
    }

    return next.handle();
  }
}

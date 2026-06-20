import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { TypeORMError } from 'typeorm';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';
    let errorCode: string | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resObj = exceptionResponse as Record<string, unknown>;
        message = resObj.message || exceptionResponse;
        errorCode =
          (resObj.errorCode as string) || (resObj.code as string) || null;
      }

      // Auto-mapping default status codes if no custom errorCode is provided
      if (!errorCode) {
        switch (status) {
          case HttpStatus.BAD_REQUEST:
            errorCode = 'validation.failed';
            break;
          case HttpStatus.UNAUTHORIZED:
            errorCode = 'auth.unauthorized';
            break;
          case HttpStatus.FORBIDDEN:
            errorCode = 'auth.forbidden';
            break;
          case HttpStatus.NOT_FOUND:
            errorCode = 'resource.not_found';
            break;
          case HttpStatus.CONFLICT:
            errorCode = 'resource.conflict';
            break;
          case HttpStatus.TOO_MANY_REQUESTS:
            errorCode = 'rate_limit.exceeded';
            break;
          default:
            errorCode = `http.error_${status}`;
        }
      }
    } else if (exception instanceof TypeORMError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      message = 'Database operation failed';
      errorCode = 'database.error';
    } else {
      errorCode = 'server.internal_error';
    }

    const requestRecord = request as unknown as Record<string, unknown>;
    const traceId = (requestRecord.traceId as string) || 'unknown';
    const statusCode = Number(status);

    const errorResponse = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      errorCode,
      message,
    };

    if (statusCode >= 500) {
      this.logger.error(
        `[${traceId}] ${request.method} ${request.url} - ${exception instanceof Error ? exception.message : 'Unknown Error'}`,
        exception instanceof Error ? exception.stack : '',
      );
    } else {
      this.logger.warn(
        `[${traceId}] ${request.method} ${request.url} - ${JSON.stringify(message)}`,
      );
    }

    response.status(statusCode).send(errorResponse);
  }
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RoleAuditLogEntity } from '../entities/role-audit-log.entity';
import { AUDIT_ACTION_KEY } from '../decorators/audit-action.decorator';

@Injectable()
export class RoleAuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    @InjectRepository(RoleAuditLogEntity)
    private auditRepo: Repository<RoleAuditLogEntity>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.get<{ action: string; target: string }>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const ipAddress = request.ip || request.socket?.remoteAddress;

    return next.handle().pipe(
      tap(() => {
        // Run audit logging asynchronously after successful request
        this.auditRepo
          .save({
            userId: user?.id || null,
            action: auditMeta.action,
            target: auditMeta.target,
            payload: request.body || {},
            ipAddress: ipAddress,
          })
          .catch((err) => {
            // Log error but don't fail request
            console.error('Failed to write audit log', err);
          });
      }),
    );
  }
}

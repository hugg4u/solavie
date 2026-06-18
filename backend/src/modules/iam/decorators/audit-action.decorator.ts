import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action_key';

export const AuditAction = (action: string, target: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { action, target });

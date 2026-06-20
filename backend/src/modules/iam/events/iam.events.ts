export class LoginNewDeviceEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly ipAddress: string,
    public readonly userAgent: string,
    public readonly timestamp: string,
  ) {}
}

export class PermissionChangedEvent {
  constructor(
    public readonly affectedUserId: string,
    public readonly changedBy: string,
    public readonly changeType: 'ASSIGN_ROLE' | 'REMOVE_ROLE' | 'UPDATE_POLICY',
    public readonly detail: Record<string, unknown>,
    public readonly timestamp: string,
  ) {}
}

export class UserCreatedEvent {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly fullName: string,
    public readonly createdBy: string,
    public readonly activationToken: string,
    public readonly timestamp: string,
    public readonly preferredLang: string = 'vi',
  ) {}
}

export class PasswordChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly changedBy: string,
    public readonly ipAddress: string,
    public readonly userAgent: string,
    public readonly timestamp: string,
  ) {}
}

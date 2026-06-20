export enum IamRedisKeys {
  BRUTE_FORCE = 'iam:brute_force:',
  ACTIVATION_HASH = 'iam:activation:hash:',
  REFRESH_TOKEN = 'iam:refresh_token:',
  USER_SESSIONS = 'iam:user_sessions:',
  USER_PERMISSIONS = 'iam:user_permissions:',
  IDEMPOTENCY = 'iam:idempotency:',
}

export enum IamEventTypes {
  PERMISSION_CHANGED = 'permission.changed',
  AUTH_USER_CREATED = 'auth.user_created',
  AUTH_LOGIN_NEW_DEVICE = 'auth.login_new_device',
  AUTH_PASSWORD_CHANGED = 'auth.password_changed',
}

export enum IamCookies {
  REFRESH_TOKEN = 'refresh_token',
  SETUP_TOKEN = 'setup_token',
}

export enum IamStrategies {
  JWT = 'jwt',
}

export enum IamQueues {
  OUTBOX = 'iam_outbox',
}

export enum IamTables {
  USERS = 'iam_users',
  USER_SETTINGS = 'iam_user_settings',
  USER_ROLES = 'iam_user_roles',
  ROLES = 'iam_roles',
  ROLE_AUDIT_LOGS = 'iam_role_audit_logs',
  POLICIES = 'iam_policies',
  PERMISSIONS = 'iam_permissions',
  OUTBOX_EVENTS = 'iam_outbox_events',
  DEVICE_HISTORIES = 'iam_device_histories',
}

export const IamDefaults = {
  LANG: 'vi',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  THEME: 'light',
} as const;

export const IamEventPriorities: Record<string, number> = {
  [IamEventTypes.PERMISSION_CHANGED]: 1, // High priority
  [IamEventTypes.AUTH_USER_CREATED]: 3, // Medium priority
  [IamEventTypes.AUTH_PASSWORD_CHANGED]: 4, // Medium-low priority
  [IamEventTypes.AUTH_LOGIN_NEW_DEVICE]: 5, // Low priority
};

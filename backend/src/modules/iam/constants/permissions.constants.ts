export const IamPermissions = {
  USERS_READ: 'iam.users.read',
  USERS_CREATE: 'iam.users.create',
  USERS_UPDATE: 'iam.users.update',

  ROLES_READ: 'iam.roles.read',
  ROLES_CREATE: 'iam.roles.create',
  ROLES_UPDATE: 'iam.roles.update',
  ROLES_DELETE: 'iam.roles.delete',

  ROLES_ASSIGN: 'iam.roles.assign',
  ROLES_REMOVE: 'iam.roles.remove',

  PERMISSIONS_READ: 'iam.permissions.read',
} as const;

export type IamPermissionType =
  (typeof IamPermissions)[keyof typeof IamPermissions];

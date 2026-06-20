import { IamPermissions } from '../constants/permissions.constants';

export const ALL_SYSTEM_PERMISSIONS = {
  ...IamPermissions,
  // Sau này có các module khác như Booking, CRM sẽ append vào đây:
  // ...BookingPermissions,
  // ...CrmPermissions,
};

export type SystemPermission =
  (typeof ALL_SYSTEM_PERMISSIONS)[keyof typeof ALL_SYSTEM_PERMISSIONS];

import type { GrantedPermission, PermissionAction, Subject } from '@athlete/contracts';

/**
 * "Would the API even consider this?" -- asked of the permissions `GET /me` returned.
 *
 * This is NOT the policy. The list is coarse `(action, subject)` pairs for the active
 * academy; which rows a pair applies to is decided on the server, per request, and
 * arrives as a 403 or 404. `can` only decides whether to draw a control the API would
 * refuse for certain. There is no wildcard to interpret: the server never reports one.
 */
export function can(
  permissions: readonly GrantedPermission[],
  action: PermissionAction,
  subject: Subject,
): boolean {
  return permissions.some(
    (permission) => permission.action === action && permission.subject === subject,
  );
}

import type { PermissionAction, Subject } from '@athlete/contracts';
import type { ReactNode } from 'react';
import { can } from './can';
import { useMe } from './use-me';

/** `can()` bound to the signed-in user: `const can = useCan(); can('create', 'athletes')`. */
export function useCan(): (action: PermissionAction, subject: Subject) => boolean {
  const { permissions } = useMe();
  return (action, subject) => can(permissions, action, subject);
}

/** Renders its children only when the signed-in user holds the pair. */
export function Can({
  action,
  subject,
  fallback = null,
  children,
}: {
  action: PermissionAction;
  subject: Subject;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return useCan()(action, subject) ? children : fallback;
}

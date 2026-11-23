import { createFileRoute, redirect } from '@tanstack/react-router';
import { can } from '@/lib/authz';

/**
 * `/` is not a page: it sends each person to where their work in the active academy
 * starts. Someone who may add athletes (an administrator) lands on the athletes list;
 * anyone else (a coach) lands on their sessions.
 *
 * Decided from the permissions `GET /me` reported for the ACTIVE academy, so the same
 * person lands differently after switching to an academy where they hold another role.
 */
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    throw redirect({
      to: can(context.me.permissions, 'create', 'athletes') ? '/athletes' : '/sessions',
      replace: true,
    });
  },
});

import type { PermissionAction, Subject } from '@athlete/contracts';
import { type Icon, IconCalendarEvent, IconShirtSport, IconUsers } from '@tabler/icons-react';
import type { LinkProps } from '@tanstack/react-router';

export interface NavigationItem {
  title: string;
  to: NonNullable<LinkProps['to']>;
  icon: Icon;
  /** The pair a user must hold for the entry to be drawn. */
  requires: { action: PermissionAction; subject: Subject };
}

/**
 * The whole menu. One app for every role: an entry is shown when the signed-in user
 * holds its permission in the active academy, so the same person sees a different
 * menu in an academy where they hold a different role.
 */
export const NAVIGATION: readonly NavigationItem[] = [
  {
    title: 'Athletes',
    to: '/athletes',
    icon: IconUsers,
    requires: { action: 'read', subject: 'athletes' },
  },
  {
    title: 'Teams',
    to: '/teams',
    icon: IconShirtSport,
    requires: { action: 'read', subject: 'teams' },
  },
  {
    title: 'Sessions',
    to: '/sessions',
    icon: IconCalendarEvent,
    requires: { action: 'read', subject: 'trainingSessions' },
  },
];

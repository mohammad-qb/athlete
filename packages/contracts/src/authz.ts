import { z } from 'zod';

/**
 * The vocabulary of authorization: what can be done, and to what.
 *
 * Names only. These are plain strings because they are shared with the browser client
 * (which hides a button the API would refuse anyway) and because `contracts-stay-pure`
 * forbids this package from importing the server. The *policy* -- which role holds
 * which pair, under which conditions -- lives in the API (`common/authz/ability.ts`)
 * and nowhere else.
 *
 * `manage` is CASL's wildcard action: it matches every other action. It is listed so a
 * route can demand it, never because a route should.
 */
export const Action = z.enum(['manage', 'read', 'create', 'update', 'delete']);
export type Action = z.infer<typeof Action>;

/**
 * One subject per authorizable table, named as the Drizzle schema names it. A subject
 * no route claims yet must be listed as reserved in `authz.route-coverage.spec.ts`, so
 * this list cannot quietly grow ahead of the API surface.
 */
export const Subject = z.enum([
  'athletes',
  'teams',
  'teamMemberships',
  'trainingSessions',
  'sessionParticipants',
  'assessments',
  'userAcademyRoles',
]).meta({ id: 'Subject' });
export type Subject = z.infer<typeof Subject>;

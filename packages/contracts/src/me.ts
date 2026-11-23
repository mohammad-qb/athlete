import { z } from 'zod';
import { Action, Subject } from './authz';
import { Role, strictObject, Uuid } from './primitives';

/**
 * The concrete actions a client can be told it holds. `manage` is CASL's wildcard and
 * is never reported: a role that holds it is listed with each of these four instead,
 * so a client has one question to ask ("is this pair in the list?") and no wildcard
 * rule of its own to keep in step with the server's.
 */
export const PermissionAction = Action.exclude(['manage']).meta({ id: 'PermissionAction' });
export type PermissionAction = z.infer<typeof PermissionAction>;

export const GrantedPermission = z
  .object({ action: PermissionAction, subject: Subject })
  .meta({ id: 'GrantedPermission' });
export type GrantedPermission = z.infer<typeof GrantedPermission>;

/** One academy the signed-in user belongs to, with every role they hold there. */
export const MeAcademy = z.object({
  id: Uuid,
  name: z.string(),
  roles: z.array(Role),
}).meta({ id: 'MeAcademy' });
export type MeAcademy = z.infer<typeof MeAcademy>;

/**
 * `GET /me`: who is signed in, where they may act, and what they may attempt there.
 *
 * `permissions` is COARSE: the `(action, subject)` pairs the user's roles in the
 * active academy could ever exercise. It exists so the client can leave out a button
 * the API would refuse anyway. It is not the policy -- which rows a pair applies to is
 * decided on the server, per request, and arrives as a 403 or a 404.
 *
 * `activeAcademyId` is null, and `permissions` empty, for an account that belongs to
 * no academy.
 */
export const MeResponse = z.object({
  user: z.object({
    id: Uuid,
    email: z.string(),
    name: z.string(),
  }),
  activeAcademyId: Uuid.nullable(),
  academies: z.array(MeAcademy),
  permissions: z.array(GrantedPermission),
}).meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof MeResponse>;

/** `POST /me/active-academy`: act in another academy the user belongs to. */
export const SwitchAcademyRequest = strictObject({ academyId: Uuid }).meta({
  id: 'SwitchAcademyRequest',
});
export type SwitchAcademyRequest = z.infer<typeof SwitchAcademyRequest>;

import {
  AbilityBuilder,
  createMongoAbility,
  subject as tagSubject,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import { Subject, type Action } from '@athlete/contracts';
import type { Principal, PrincipalScope } from './principal';

/**
 * The columns a rule may condition on, per subject -- and nothing else. This is the
 * whole "flat conditions" decision as a type: there is no relation here to traverse,
 * and a condition on a field that is not listed does not compile.
 */
export interface SubjectRows {
  athletes: { id: string };
  teams: { id: string };
  teamMemberships: { teamId: string };
  trainingSessions: { teamId: string };
  sessionParticipants: { teamIdAtTime: string };
  assessments: { athleteId: string; teamIdAtTime: string | null; assessedByUserId: string };
  userAcademyRoles: { userId: string };
}

type TaggedRow = { [S in Subject]: SubjectRows[S] & ForcedSubject<S> }[Subject];

/**
 * A subject is named by its type (`'athletes'`) for route gates and query filters, or is
 * a loaded row tagged with its type (see `asSubject`) for an instance check.
 */
type AppSubject = Subject | 'all' | TaggedRow;

export type AppAbility = MongoAbility<[Action, AppSubject]>;

/**
 * Coarse: "may this role EVER do this?" -- no conditions, no database. Built in the
 * guard, which runs before the tenant transaction exists.
 *
 * Scoped: "to WHICH rows?" -- the same grants carrying conditions over the principal's
 * resolved scope. Built inside the tenant transaction.
 *
 * Both come from the one definition below, so they cannot drift into two policies. The
 * split exists so that a conditional grant can never satisfy a route gate by accident:
 * `can('read', 'athletes')` on a conditional rule answers true for any type-level
 * check, which is precisely how a customer's scoped `read` ends up opening a
 * back-office route in designs that use one ability for both jobs.
 */
export type AbilityMode = { scoped: false } | { scoped: true; scope: PrincipalScope };

/** Every subject except the role-grant table. See the academy_admin grant below. */
const ADMINISTERED_SUBJECTS = Subject.options.filter((s) => s !== 'userAcademyRoles');

/**
 * THE authorization policy. Every grant in the system is in this function; a role
 * check written anywhere else is a bug.
 *
 * What is deliberately absent: any `academyId` condition. Tenancy is enforced by RLS
 * (`academy_id = app_current_academy()`) on the transaction every query runs in, so a
 * tenant clause here would be a second, weaker statement of a guarantee the database
 * already makes -- and a place for the two to disagree.
 */
export function defineAbility(principal: Principal, mode: AbilityMode): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const roles = new Set(principal.roles);

  // Platform staff operate any academy they have selected. The token still names ONE
  // academy and RLS still confines the transaction to it, so `manage all` means
  // "everything in the current tenant", not "everything".
  if (roles.has('platform_admin')) {
    can('manage', 'all');
    return build();
  }

  if (roles.has('academy_admin')) {
    // An academy administrator runs their academy: every operational record, with no
    // row condition, because the only boundary that applies to them is the tenant one
    // and RLS draws it.
    can('manage', ADMINISTERED_SUBJECTS);

    // Role grants are readable but not writable. Minting a role is not an API
    // operation in this slice; leaving `manage` off means a future route that tries
    // to write this table is refused by the policy rather than by someone noticing.
    can('read', 'userAcademyRoles');
  }

  if (roles.has('coach')) {
    if (!mode.scoped) {
      // The route-level answer: a coach may reach these operations at all.
      can(['read', 'update'], 'athletes');
      can('read', ['teams', 'teamMemberships']);
      can(['read', 'create'], 'trainingSessions');
      can(['read', 'create', 'update'], 'sessionParticipants');
    } else {
      const { activeTeamIds, visibleAthleteIds } = mode.scope;

      // A coach with no current assignment gets NO rule, not a rule over an empty
      // list. `{ $in: [] }` would compile to a filter that matches nothing and return
      // an empty page -- the "inexplicably empty result set" docs/02 argues against.
      // With no rule, `accessibleBy` throws FORBIDDEN and the caller is told why.
      if (activeTeamIds.length > 0) {
        // The teams they coach now, and only now: a coach who left in March reads
        // nothing of that team's roster today, because the assignment period -- not a
        // flag on the user -- is what grants the visibility.
        can('read', 'teams', { id: { $in: activeTeamIds } });
        can('read', 'teamMemberships', { teamId: { $in: activeTeamIds } });

        // Coaches schedule sessions for their own teams.
        can(['read', 'create'], 'trainingSessions', { teamId: { $in: activeTeamIds } });

        // Attendance is keyed on the team AS RECORDED on the fact (`teamIdAtTime`),
        // not the athlete's team today, so a register stays attributable to the team
        // that ran the session after the athlete transfers.
        can(['read', 'create', 'update'], 'sessionParticipants', {
          teamIdAtTime: { $in: activeTeamIds },
        });
      }

      if (visibleAthleteIds.length > 0) {
        // Athletes currently on a team the coach currently coaches. Both periods are
        // resolved at the same `asOf`, so an athlete who transferred away yesterday is
        // out of scope today.
        can(['read', 'update'], 'athletes', { id: { $in: visibleAthleteIds } });
      }
    }
  }

  // `athlete`: nothing. An athlete should read their own record, but the
  // athlete <-> user link is not modelled in this slice, and granting on a guess would
  // be worse than denying. Stated here so the absence reads as a decision.

  return build();
}

/**
 * Tags a loaded row with its subject type for an instance check:
 * `ability.can('read', asSubject('athletes', row))`. A copy is tagged, never the row
 * itself -- CASL marks the object it is given, and a repository row must not carry an
 * authorization marker into a response mapper.
 */
export function asSubject<S extends Subject>(
  type: S,
  row: SubjectRows[S],
): SubjectRows[S] & ForcedSubject<S> {
  return tagSubject(type, { ...row });
}

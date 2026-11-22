import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Recorded facts are never deleted or edited: a wrong one is VOIDED (who, when) and a
 * correct row inserted beside it. `voided_at IS NULL` is what "active" means -- see
 * `common/db/active-row.ts`, the one predicate every fact read applies.
 */
const voiding = {
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
};

/**
 * Typed mirror of the hand-written SQL in ../../drizzle. The SQL is the source of
 * truth for constraints, policies and generated columns; this file exists so the
 * repository layer is type-safe. Drizzle never generates the migrations here.
 */

export const academies = pgTable('academies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userAcademyRoles = pgTable(
  'user_academy_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_academy_roles_uq').on(t.academyId, t.userId, t.role)],
);

export const athletes = pgTable(
  'athletes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('athletes_tenant_uq').on(t.academyId, t.id),
    index('athletes_academy_name_idx').on(t.academyId, t.lastName, t.firstName),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    name: text('name').notNull(),
    sport: text('sport').notNull(),
    ageGroup: text('age_group'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('teams_tenant_uq').on(t.academyId, t.id),
    unique('teams_name_uq').on(t.academyId, t.name),
  ],
);

/** valid_to NULL means "still current". `period` is a generated tstzrange in SQL. */
export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    teamId: uuid('team_id').notNull(),
    athleteId: uuid('athlete_id').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ...voiding,
  },
  (t) => [index('team_memberships_athlete_idx').on(t.academyId, t.athleteId)],
);

export const teamCoachAssignments = pgTable(
  'team_coach_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    teamId: uuid('team_id').notNull(),
    coachUserId: uuid('coach_user_id').notNull(),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_coach_assignments_coach_idx').on(t.coachUserId, t.academyId)],
);

export const trainingSessions = pgTable(
  'training_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    teamId: uuid('team_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    location: text('location'),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('training_sessions_tenant_uq').on(t.academyId, t.id)],
);

export const sessionParticipants = pgTable(
  'session_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    athleteId: uuid('athlete_id').notNull(),
    teamIdAtTime: uuid('team_id_at_time').notNull(),
    status: text('status').notNull(),
    note: text('note'),
    clientRecordId: uuid('client_record_id').notNull(),
    recordedByUserId: uuid('recorded_by_user_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(0),
    ...voiding,
  },
  (t) => [
    // One ACTIVE entry per athlete per session: a voided row must not block its replacement.
    uniqueIndex('session_participants_once_per_session')
      .on(t.sessionId, t.athleteId)
      .where(sql`voided_at is null`),
    unique('session_participants_idempotency_uq').on(t.academyId, t.clientRecordId),
  ],
);

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    academyId: uuid('academy_id').notNull(),
    athleteId: uuid('athlete_id').notNull(),
    teamIdAtTime: uuid('team_id_at_time'),
    assessedByUserId: uuid('assessed_by_user_id').notNull(),
    assessedAt: timestamp('assessed_at', { withTimezone: true }).notNull().defaultNow(),
    metrics: jsonb('metrics').notNull().default({}),
    notes: text('notes'),
    ...voiding,
  },
  (t) => [index('assessments_athlete_idx').on(t.academyId, t.athleteId, t.assessedAt)],
);

export const schema = {
  academies,
  users,
  userAcademyRoles,
  athletes,
  teams,
  teamMemberships,
  teamCoachAssignments,
  trainingSessions,
  sessionParticipants,
  assessments,
};

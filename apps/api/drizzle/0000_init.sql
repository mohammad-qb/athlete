-- =============================================================================
-- 0000_init.sql  --  core schema
--
-- Conventions that carry the integrity guarantees of this design:
--   1. Every tenant-owned table has academy_id, and a UNIQUE (academy_id, id) so
--      children can declare COMPOSITE foreign keys. RLS stops you READING another
--      academy's rows; composite FKs stop you REFERENCING them.
--   2. Relationships that change over time are stored as PERIODS, never as a
--      mutable column. Nothing is overwritten, so history stays truthful.
--   3. Mutable resources carry `version` for optimistic concurrency (ETag/If-Match).
--   4. Recorded facts (participation, assessments) use ON DELETE RESTRICT so history
--      cannot be silently destroyed by deleting a parent.
-- =============================================================================

create extension if not exists btree_gist;  -- required for `=` inside an exclusion constraint

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table academies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Users are deliberately NOT tenant-scoped: one person may be a coach at academy A
-- and an administrator at academy B. Tenancy lives on the role assignment, not the user.
create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,
  full_name      text not null,
  created_at     timestamptz not null default now()
);
create unique index users_email_lower_uq on users (lower(email));

create table user_academy_roles (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references academies(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  role        text not null check (role in ('platform_admin','academy_admin','coach','athlete')),
  created_at  timestamptz not null default now(),
  constraint user_academy_roles_uq unique (academy_id, user_id, role)
);
create index user_academy_roles_user_idx on user_academy_roles (user_id);

-- ---------------------------------------------------------------------------
-- Domain entities
-- ---------------------------------------------------------------------------
create table athletes (
  id             uuid not null default gen_random_uuid(),
  academy_id     uuid not null references academies(id) on delete cascade,
  first_name     text not null,
  last_name      text not null,
  date_of_birth  date not null,
  version        integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint athletes_pk primary key (id),
  constraint athletes_tenant_uq unique (academy_id, id)
);
create index athletes_academy_name_idx on athletes (academy_id, last_name, first_name);

create table teams (
  id          uuid not null default gen_random_uuid(),
  academy_id  uuid not null references academies(id) on delete cascade,
  name        text not null,
  sport       text not null,
  age_group   text,
  version     integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint teams_pk primary key (id),
  constraint teams_tenant_uq unique (academy_id, id),
  constraint teams_name_uq unique (academy_id, name)
);

-- ---------------------------------------------------------------------------
-- Temporal relationships
-- ---------------------------------------------------------------------------
create table team_memberships (
  id          uuid not null default gen_random_uuid(),
  academy_id  uuid not null references academies(id) on delete cascade,
  team_id     uuid not null,
  athlete_id  uuid not null,
  valid_from  timestamptz not null,
  valid_to    timestamptz,
  period      tstzrange generated always as (tstzrange(valid_from, valid_to, '[)')) stored,
  created_at  timestamptz not null default now(),
  constraint team_memberships_pk primary key (id),
  constraint team_memberships_team_fk
    foreign key (academy_id, team_id) references teams(academy_id, id) on delete cascade,
  constraint team_memberships_athlete_fk
    foreign key (academy_id, athlete_id) references athletes(academy_id, id) on delete cascade,
  constraint team_memberships_period_valid
    check (valid_to is null or valid_to > valid_from),

  -- SCOPE DECIDED DELIBERATELY. An athlete MAY belong to several teams at the same
  -- time -- a U17 squad and the first team, or football and athletics. What is
  -- forbidden is a duplicate or overlapping period for the SAME athlete in the SAME
  -- team, which is the actual data-integrity defect. Any stricter "one team at a
  -- time" rule is academy policy and belongs in the service layer, not the schema.
  constraint team_memberships_no_overlap_same_team
    exclude using gist (athlete_id with =, team_id with =, period with &&)
);
create index team_memberships_team_period_idx on team_memberships using gist (team_id, period);
create index team_memberships_athlete_idx on team_memberships (academy_id, athlete_id);

create table team_coach_assignments (
  id             uuid not null default gen_random_uuid(),
  academy_id     uuid not null references academies(id) on delete cascade,
  team_id        uuid not null,
  coach_user_id  uuid not null references users(id) on delete restrict,
  valid_from     timestamptz not null,
  valid_to       timestamptz,
  period         tstzrange generated always as (tstzrange(valid_from, valid_to, '[)')) stored,
  created_at     timestamptz not null default now(),
  constraint team_coach_assignments_pk primary key (id),
  constraint team_coach_assignments_team_fk
    foreign key (academy_id, team_id) references teams(academy_id, id) on delete cascade,
  constraint team_coach_assignments_period_valid
    check (valid_to is null or valid_to > valid_from),
  constraint team_coach_assignments_no_overlap
    exclude using gist (team_id with =, coach_user_id with =, period with &&)
);
create index team_coach_assignments_coach_idx on team_coach_assignments (coach_user_id, academy_id);

-- ---------------------------------------------------------------------------
-- Sessions and recorded facts
-- ---------------------------------------------------------------------------
create table training_sessions (
  id          uuid not null default gen_random_uuid(),
  academy_id  uuid not null references academies(id) on delete cascade,
  team_id     uuid not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  location    text,
  version     integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint training_sessions_pk primary key (id),
  constraint training_sessions_tenant_uq unique (academy_id, id),
  constraint training_sessions_team_fk
    foreign key (academy_id, team_id) references teams(academy_id, id) on delete cascade,
  constraint training_sessions_time_valid check (ends_at > starts_at)
);
create index training_sessions_team_start_idx on training_sessions (academy_id, team_id, starts_at desc);

-- Attendance is stored as PARTICIPATION: a fact about who took part, carrying the team
-- context as it was at that moment (team_id_at_time). It is never recomputed from
-- current membership -- which is precisely why a transfer cannot rewrite last month's
-- register. See test/history.transfer.spec.ts.
create table session_participants (
  id                   uuid not null default gen_random_uuid(),
  academy_id           uuid not null references academies(id) on delete cascade,
  session_id           uuid not null,
  athlete_id           uuid not null,
  team_id_at_time      uuid not null,
  status               text not null check (status in ('present','absent','late','excused')),
  note                 text,
  client_record_id     uuid not null,
  recorded_by_user_id  uuid not null references users(id) on delete restrict,
  recorded_at          timestamptz not null default now(),
  version              integer not null default 0,
  constraint session_participants_pk primary key (id),
  constraint session_participants_session_fk
    foreign key (academy_id, session_id) references training_sessions(academy_id, id) on delete cascade,
  constraint session_participants_athlete_fk
    foreign key (academy_id, athlete_id) references athletes(academy_id, id) on delete restrict,
  constraint session_participants_team_fk
    foreign key (academy_id, team_id_at_time) references teams(academy_id, id) on delete restrict,
  constraint session_participants_once_per_session unique (session_id, athlete_id),
  -- Client-generated id makes a retried or late-syncing offline submission safe to replay.
  constraint session_participants_idempotency_uq unique (academy_id, client_record_id)
);
create index session_participants_session_idx on session_participants (academy_id, session_id);
create index session_participants_athlete_idx on session_participants (academy_id, athlete_id, recorded_at desc);

-- Assessments are append-only facts. No version column: they are not edited, they are
-- superseded. team_id_at_time preserves the context the assessment was made in, and
-- assessed_by_user_id is what lets a departed coach still read their own work.
create table assessments (
  id                   uuid not null default gen_random_uuid(),
  academy_id           uuid not null references academies(id) on delete cascade,
  athlete_id           uuid not null,
  team_id_at_time      uuid,
  assessed_by_user_id  uuid not null references users(id) on delete restrict,
  assessed_at          timestamptz not null default now(),
  -- Per-sport metrics (sprint splits, shot accuracy, ...) without EAV or a column per sport.
  metrics              jsonb not null default '{}'::jsonb,
  notes                text,
  constraint assessments_pk primary key (id),
  constraint assessments_athlete_fk
    foreign key (academy_id, athlete_id) references athletes(academy_id, id) on delete restrict,
  constraint assessments_team_fk
    foreign key (academy_id, team_id_at_time) references teams(academy_id, id) on delete restrict,
  constraint assessments_metrics_is_object check (jsonb_typeof(metrics) = 'object')
);
create index assessments_athlete_idx on assessments (academy_id, athlete_id, assessed_at desc);
create index assessments_metrics_gin on assessments using gin (metrics jsonb_path_ops);

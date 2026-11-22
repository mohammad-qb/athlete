-- =============================================================================
-- 0002_grants.sql  --  the privilege matrix, and facts that cannot be destroyed
--
-- 0001 gave `athlete_app` SELECT/INSERT/UPDATE/DELETE on every table and made that
-- the DEFAULT for every table a later migration creates. One role with full DML
-- everywhere means the application layer is the only thing standing between a bug
-- (or an injected statement) and a deleted register or a minted role grant.
--
-- This migration makes the database refuse what the application should never ask:
--
--   1. No DELETE on anything. Recorded facts are corrected by VOIDING a row and
--      inserting its replacement, so the wrong version stays on record as wrong.
--   2. Recorded facts are otherwise insert-only: UPDATE is granted per COLUMN, on
--      the voiding columns alone (plus `valid_to`, which closes a period) -- and a
--      trigger makes each of those columns final once set, so a closed period cannot
--      be reopened and a void cannot be undone.
--   3. Identity and authority are read-only: the application cannot create a user,
--      an academy, or a role grant -- and cannot read `users` (credentials) at all.
--   4. A table added by a future migration is unreachable until that migration
--      grants on it explicitly.
--   5. A fact cannot be removed indirectly either: the two parents that CASCADED
--      onto fact tables now RESTRICT.
--
-- Forward-only: 0000 and 0001 are not edited. Everything here supersedes them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Voiding. A fact that was recorded wrongly is not edited and not deleted: it is
-- marked void, by someone, at a time -- and a correct row is inserted beside it.
-- ---------------------------------------------------------------------------
alter table session_participants
  add column voided_at timestamptz,
  add column voided_by uuid references users(id) on delete restrict,
  add constraint session_participants_void_attributed
    check ((voided_at is null) = (voided_by is null));

alter table assessments
  add column voided_at timestamptz,
  add column voided_by uuid references users(id) on delete restrict,
  add constraint assessments_void_attributed
    check ((voided_at is null) = (voided_by is null));

alter table team_memberships
  add column voided_at timestamptz,
  add column voided_by uuid references users(id) on delete restrict,
  add constraint team_memberships_void_attributed
    check ((voided_at is null) = (voided_by is null));

-- "One register entry per athlete per session" must mean one ACTIVE entry, or a
-- voided row would make its own replacement impossible. Postgres cannot put a WHERE
-- on a unique CONSTRAINT, so the constraint becomes a partial unique index of the
-- same name.
alter table session_participants drop constraint session_participants_once_per_session;
create unique index session_participants_once_per_session
  on session_participants (session_id, athlete_id)
  where voided_at is null;

-- session_participants_idempotency_uq on (academy_id, client_record_id) is left as a
-- full constraint on purpose: `on conflict` targets it, and a replayed offline
-- submission must stay a no-op even if the row it first created was later voided. A
-- replacement row is a new record and carries a new client_record_id.

-- Likewise a voided membership must stop occupying its period.
alter table team_memberships drop constraint team_memberships_no_overlap_same_team;
alter table team_memberships
  add constraint team_memberships_no_overlap_same_team
    exclude using gist (athlete_id with =, team_id with =, period with &&)
    where (voided_at is null);

-- ---------------------------------------------------------------------------
-- No indirect deletion. 0000's header claims recorded facts use ON DELETE RESTRICT,
-- but these parents cascaded: deleting a training session emptied its register, and
-- deleting a team or an athlete erased the membership history. They now RESTRICT.
--
-- What still cascades, deliberately: `academy_id -> academies` on every table
-- (offboarding a tenant removes the tenant), and teams -> training_sessions /
-- team_coach_assignments, which are not recorded facts. A session WITH a register is
-- protected through the first constraint below.
-- ---------------------------------------------------------------------------
alter table session_participants
  drop constraint session_participants_session_fk,
  add constraint session_participants_session_fk
    foreign key (academy_id, session_id) references training_sessions(academy_id, id) on delete restrict;

alter table team_memberships
  drop constraint team_memberships_team_fk,
  add constraint team_memberships_team_fk
    foreign key (academy_id, team_id) references teams(academy_id, id) on delete restrict,
  drop constraint team_memberships_athlete_fk,
  add constraint team_memberships_athlete_fk
    foreign key (academy_id, athlete_id) references athletes(academy_id, id) on delete restrict;

-- ---------------------------------------------------------------------------
-- The privilege matrix. Revoke everything, then grant back table by table.
--
-- `alter default privileges` is recorded per GRANTING role: this undoes the default
-- set in 0001 only when run by the same role that ran 0001, which is the case for a
-- single migration identity. A table created by any other role never had the default.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from athlete_app;
revoke all on all tables in schema public from athlete_app;

-- Identity and authority: read-only. Onboarding an academy, creating a user and
-- granting a role are platform operations performed by a different identity.
grant select on academies, user_academy_roles to athlete_app;

-- `users` gets nothing. It carries no academy_id and so no RLS policy, and it holds
-- `password_hash`: SELECT on it would hand any statement running as the application
-- role every tenant's credentials. Nothing in the API reads the table today (foreign
-- keys onto it are checked as the table owner, not as the inserting role); whatever
-- first needs a user's name gets a column-level grant in its own migration.

-- Mutable entities: ordinary DML, minus DELETE. Each is the parent of recorded facts.
grant select, insert, update on athletes, teams, training_sessions to athlete_app;

-- A coach assignment is a period that grants visibility. It can be opened and
-- closed; it cannot be rewritten or removed.
grant select, insert on team_coach_assignments to athlete_app;
grant update (valid_to) on team_coach_assignments to athlete_app;

-- Recorded facts: read, append, void. Nothing else.
grant select, insert on session_participants, assessments, team_memberships to athlete_app;
grant update (voided_at, voided_by) on session_participants, assessments to athlete_app;
-- A membership is also a period, so closing it (a transfer) is the one more column.
grant update (valid_to, voided_at, voided_by) on team_memberships to athlete_app;

-- `_migrations` gets nothing: the application has no business reading or writing it.

-- ---------------------------------------------------------------------------
-- Final once set. A column-level UPDATE grant says WHICH column may be written, not
-- which transition: with the grant alone the application role could set a closed
-- coach assignment's `valid_to` back to NULL (restoring that coach's access), move a
-- membership's end date, or clear `voided_at` to bring a voided fact back. So each of
-- these columns goes from NULL to a value exactly once.
--
-- The table owner (and so a superuser, and the migration identity) is exempt: a
-- repair by the platform is a deliberate act under a different identity, the same
-- line the grants above draw. The function is SECURITY INVOKER on purpose, so that
-- `current_user` is the role that issued the UPDATE.
-- ---------------------------------------------------------------------------
create function app_final_once_set() returns trigger
  language plpgsql
as $$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  col text;
begin
  if pg_has_role(current_user, (select relowner from pg_class where oid = tg_relid), 'USAGE') then
    return new;
  end if;

  foreach col in array tg_argv loop
    if jsonb_typeof(old_row -> col) <> 'null' and new_row -> col is distinct from old_row -> col then
      raise exception '%.% is final once set', tg_table_name, col
        using errcode = 'integrity_constraint_violation';
    end if;
  end loop;
  return new;
end
$$;

comment on function app_final_once_set() is
  'Row trigger: the columns named as arguments may go from NULL to a value once, and never change again, for any role that does not own the table.';

create trigger team_coach_assignments_final_once_set
  before update on team_coach_assignments
  for each row execute function app_final_once_set('valid_to');

create trigger team_memberships_final_once_set
  before update on team_memberships
  for each row execute function app_final_once_set('valid_to', 'voided_at', 'voided_by');

create trigger session_participants_final_once_set
  before update on session_participants
  for each row execute function app_final_once_set('voided_at', 'voided_by');

create trigger assessments_final_once_set
  before update on assessments
  for each row execute function app_final_once_set('voided_at', 'voided_by');

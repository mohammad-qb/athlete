-- =============================================================================
-- 0001_rls.sql  --  tenant isolation enforced by the database
--
-- Two details that decide whether an RLS design is real or decorative:
--
--   1. RLS DOES NOT APPLY TO THE TABLE OWNER. A default setup where the app connects
--      as the owning role has silently inert policies. We handle this twice over:
--      the application connects as `athlete_app` (a non-owner role, explicitly
--      without BYPASSRLS), AND every table is set to FORCE ROW LEVEL SECURITY so the
--      owner is subject to policies too. Tests therefore exercise real policies.
--
--   2. The tenant key arrives via a TRANSACTION-SCOPED setting (SET LOCAL). It dies
--      with the transaction, so it cannot leak onto the next request sharing a pooled
--      connection, and it works correctly behind a transaction-mode pooler (PgBouncer,
--      Azure's built-in pooler).
--
-- Fail-closed by construction: if no tenant context is set, app_current_academy()
-- returns NULL, `academy_id = NULL` is NULL, and the row is not visible. A query that
-- forgets its tenant context returns nothing -- it does not return everything.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Application role: not the owner, no BYPASSRLS, login handled via Key Vault secret.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'athlete_app') then
    create role athlete_app nologin nobypassrls;
  end if;
end
$$;

grant usage on schema public to athlete_app;
grant select, insert, update, delete on all tables in schema public to athlete_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to athlete_app;

-- ---------------------------------------------------------------------------
-- Tenant context accessor
-- ---------------------------------------------------------------------------
create or replace function app_current_academy() returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.current_academy_id', true), '')::uuid
$$;

comment on function app_current_academy() is
  'Transaction-scoped tenant key, set by the API via SET LOCAL. NULL means no context, which makes every policy evaluate false.';

-- ---------------------------------------------------------------------------
-- Policies. Applied to every tenant-owned table, with WITH CHECK as well as USING so
-- a tenant cannot INSERT or UPDATE a row into another academy either.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'athletes',
    'teams',
    'team_memberships',
    'team_coach_assignments',
    'training_sessions',
    'session_participants',
    'assessments',
    'user_academy_roles'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant_isolation', t);
    execute format(
      'create policy %I on %I using (academy_id = app_current_academy()) with check (academy_id = app_current_academy())',
      t || '_tenant_isolation', t
    );
  end loop;
end
$$;

-- The academies table keys on its own id rather than an academy_id column.
alter table academies enable row level security;
alter table academies force row level security;
drop policy if exists academies_tenant_isolation on academies;
create policy academies_tenant_isolation on academies
  using (id = app_current_academy())
  with check (id = app_current_academy());

-- ---------------------------------------------------------------------------
-- Authentication bootstrap problem, handled explicitly rather than by weakening RLS.
--
-- Login happens BEFORE a tenant context exists: we must look up a user and the
-- academies they belong to while app_current_academy() is still NULL. Rather than
-- leave user_academy_roles unprotected, we expose exactly that one lookup through a
-- SECURITY DEFINER function with a pinned search_path. It is the only sanctioned way
-- to read across tenants, it returns no athlete, session or assessment data, and it
-- is small enough to audit on one screen.
-- ---------------------------------------------------------------------------
create or replace function app_academies_for_user(p_user_id uuid)
  returns table (academy_id uuid, role text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select uar.academy_id, uar.role
  from user_academy_roles uar
  where uar.user_id = p_user_id
$$;

revoke all on function app_academies_for_user(uuid) from public;
grant execute on function app_academies_for_user(uuid) to athlete_app;

comment on function app_academies_for_user(uuid) is
  'Login-time cross-tenant lookup. The ONLY SECURITY DEFINER path in the schema: returns role assignments only, never domain data.';

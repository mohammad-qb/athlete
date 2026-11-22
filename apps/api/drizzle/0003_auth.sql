-- =============================================================================
-- 0003_auth.sql  --  cookie sessions, and a database role that holds credentials
--
-- Authentication moves from a signed bearer token to better-auth: sessions are rows,
-- the browser holds an opaque httpOnly cookie, and passwords are hashed by the library.
-- See docs/adr/0006-cookie-sessions-and-the-auth-role.md.
--
-- The privilege split of 0002 is kept and extended rather than relaxed:
--
--   athlete_app   serves requests. Still holds NOTHING on `users`, and nothing on any
--                 table created here. A statement running as the application role
--                 cannot read a password hash or a session token.
--   athlete_auth  is what better-auth connects as. It reads and writes identity and
--                 sessions, and holds nothing on any tenant-owned table: it cannot read
--                 an athlete, and it cannot read or mint a role grant.
--
-- Column names are better-auth 1.7's core schema in snake_case; the mapping is in
-- apps/api/src/modules/auth/auth.factory.ts. These tables are deliberately absent from
-- src/db/schema.ts: nothing that goes through Drizzle may touch them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- users: the columns better-auth expects, minus the credential.
--
-- `password_hash` goes. better-auth keeps the hash on the ACCOUNT row
-- (provider_id = 'credential'), and the column only ever held the placeholder 'x':
-- no API version read it, because the application role has no privilege on this table.
-- ---------------------------------------------------------------------------
alter table users
  add column email_verified boolean not null default false,
  add column image text,
  add column updated_at timestamptz not null default now(),
  drop column password_hash;

-- ---------------------------------------------------------------------------
-- Sessions. `token` is the value of the cookie, so reading this table is as good as
-- being signed in as everyone in it.
--
-- `active_academy_id` is ours, not better-auth's: which academy this session is acting
-- in. It is written only by the server (auth-session.store.ts) and is declared to
-- better-auth with `input: false`, so the browser cannot set it through
-- /api/auth/update-session. ON DELETE SET NULL: offboarding an academy must not sign
-- anyone out, it just leaves the session to pick another academy on the next request.
-- ---------------------------------------------------------------------------
create table auth_sessions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users(id) on delete cascade,
  token              text not null,
  expires_at         timestamptz not null,
  ip_address         text,
  user_agent         text,
  active_academy_id  uuid references academies(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint auth_sessions_token_uq unique (token)
);
create index auth_sessions_user_idx on auth_sessions (user_id);

-- ---------------------------------------------------------------------------
-- Accounts: one row per way a user can prove who they are. Only 'credential' exists
-- in v1, with account_id = the user's id and the scrypt hash in `password`. The OAuth
-- columns are part of the library's schema and stay NULL.
-- ---------------------------------------------------------------------------
create table auth_accounts (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references users(id) on delete cascade,
  account_id                text not null,
  provider_id               text not null,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint auth_accounts_provider_account_uq unique (provider_id, account_id)
);
create index auth_accounts_user_idx on auth_accounts (user_id);

-- Short-lived tokens the library issues (email verification, password reset). Nothing
-- in v1 writes one; the table exists because the library's schema is not optional.
create table auth_verifications (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,
  value       text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index auth_verifications_identifier_idx on auth_verifications (identifier);

-- ---------------------------------------------------------------------------
-- The auth role: not the owner, no BYPASSRLS, login provisioned outside the migration
-- exactly as for athlete_app (Key Vault in production, AUTH_ROLE_PASSWORD locally).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'athlete_auth') then
    create role athlete_auth nologin nobypassrls;
  end if;
end
$$;

grant usage on schema public to athlete_auth;

-- Identity: read, create, update. No DELETE: removing a person is a platform operation
-- with history attached to it (voided_by, recorded_by_user_id), not a library call.
grant select, insert, update on users to athlete_auth;

-- Sessions, accounts and verification tokens are the library's own state, and it does
-- delete them: signing out removes the session row, which is what makes a stolen
-- cookie worthless afterwards.
grant select, insert, update, delete on auth_sessions, auth_accounts, auth_verifications to athlete_auth;

-- Nothing here for athlete_app, and stated rather than assumed: 0002 removed the
-- default privilege, so these tables were never granted -- this makes the migration
-- safe to read on its own and safe if a default is ever reintroduced.
revoke all on auth_sessions, auth_accounts, auth_verifications from athlete_app;

-- ---------------------------------------------------------------------------
-- The cross-tenant lookup now also names the academy, so the API can offer "which
-- academy?" without the application role gaining anything on its own: it already holds
-- SELECT on `academies`, but RLS hides every academy until a tenant key is set, and
-- this lookup runs before one is.
--
-- The return type changes, so the function is dropped and recreated rather than
-- replaced. It remains the ONLY SECURITY DEFINER function in the schema.
-- ---------------------------------------------------------------------------

-- First, a defect in 0001 that nothing exercised until now. A SECURITY DEFINER function
-- runs as its OWNER, and 0001 set FORCE ROW LEVEL SECURITY on both tables it reads -- so
-- the owner is confined by the tenant policy too, and with no tenant key that policy
-- hides every row. The function therefore returned NOTHING unless the owner happened to
-- be a superuser, which it is in a test container and in compose, and is not on a
-- managed Postgres. Every sign-in in production would have resolved to "no academy".
--
-- So the migrating role -- which owns the function -- is given a SELECT policy of its
-- own on exactly these two tables. Permissive policies are OR-ed, and this one names
-- one role: `athlete_app` still sees these tables through the tenant policy alone. What
-- is given up is narrow and stated: the owner can now READ role grants and academy
-- names across tenants without setting a tenant key. It could always have done so by
-- dropping the policy; writes by the owner are still confined (WITH CHECK is untouched).
-- Asserted by test/auth.owner.integration.spec.ts, which migrates as a non-superuser.
do $$
begin
  execute format(
    'create policy user_academy_roles_owner_lookup on user_academy_roles for select to %I using (true)',
    current_user
  );
  execute format(
    'create policy academies_owner_lookup on academies for select to %I using (true)',
    current_user
  );
end
$$;

drop function app_academies_for_user(uuid);

create function app_academies_for_user(p_user_id uuid)
  returns table (academy_id uuid, academy_name text, role text)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select uar.academy_id, a.name, uar.role
  from user_academy_roles uar
  join academies a on a.id = uar.academy_id
  where uar.user_id = p_user_id
$$;

revoke all on function app_academies_for_user(uuid) from public;
grant execute on function app_academies_for_user(uuid) to athlete_app;

comment on function app_academies_for_user(uuid) is
  'Cross-tenant lookup for the signed-in user. The ONLY SECURITY DEFINER path in the schema: returns role assignments and academy names only, never domain data.';

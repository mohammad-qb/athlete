# 6. Cookie sessions, and a database role of their own

- **Status:** Accepted.
- **Date:** 2026-11-22

## Context

The slice authenticated a request by verifying an HMAC-signed bearer token that named a
user, an academy and a list of roles. Nothing stored a credential and nothing could
revoke a token; the README said so. A browser client needs the real thing: a password
checked against a hash, a session that can be ended, and a way to carry it that a
script on the page cannot read.

[01 §7](../01-technology-stack.md#7-authentication--better-auth-users-in-our-own-postgres)
had already named the library, better-auth, and had left one piece of design open: the
application role `athlete_app` holds nothing on `users`
([ADR 0004](./0004-privilege-matrix-and-voiding.md)), so the library needs "either its
own database role or a narrow, explicit grant". This record closes that, and the
decisions that came with wiring it in.

## Decision

> **A session is a database row behind an httpOnly cookie. better-auth owns identity and
> sessions through its own database role; the application role still cannot read a
> credential. Which academy a session acts in is decided by the server, and what a user
> may do there is read from the database on every request.**

- **Transport: an httpOnly, SameSite=Lax cookie holding an opaque session token.** No
  bearer token, and the HMAC token is deleted rather than kept beside it: two ways in
  is two things to keep right. The cookie cache stays off, so each request reads the
  session row and a revoked session stops working on the next request.
- **A second role, `athlete_auth`, and a second pool.** It holds `SELECT, INSERT,
  UPDATE` on `users` and full DML on `auth_sessions`, `auth_accounts` and
  `auth_verifications`, and nothing on any tenant-owned table. `athlete_app` holds
  nothing on any of those four. Each can do its own job and cannot do the other's: a
  statement running as the application role cannot read a password hash or a session
  token, and better-auth cannot read an athlete or mint a role grant. The pool is
  private to the auth module; no feature module can be handed it.
- **A `pg.Pool` given to better-auth directly, not its Drizzle adapter.** The adapter
  requires `drizzle-orm >= 0.45.2` and the API is on 0.44. It would also put the auth
  tables into the schema the application role's queries are built from; they are
  deliberately absent from `src/db/schema.ts`.
- **The active academy lives on the session row** (`active_academy_id`), written only
  by `AuthSessionStore`. It is declared to better-auth with `input: false`, because the
  library's own `POST /api/auth/update-session` would otherwise let the browser choose
  its tenant. A session with no choice, or one whose academy the user no longer belongs
  to, falls back to the first academy by name and the row is rewritten.
- **Roles are never stored in the session.** `AuthenticationGuard` asks
  `app_academies_for_user()` on every request. Revoking a role is a `DELETE` that takes
  effect immediately, which a role list inside a token could not offer.
- **An origin check on every state-changing request to our routes** (`OriginGuard`,
  the first global guard): a present `Origin` that is not `APP_BASE_URL`'s is refused
  with `invalid_origin`. This is in addition to SameSite=Lax and to better-auth's own
  check on `/api/auth/*`. CORS is removed: the SPA is same-origin.
- **A third authorization declaration, `@Authenticated()`**, for routes about the
  caller (`GET /me`, `POST /me/active-academy`). A route carries exactly one of
  `@Public`, `@Authenticated` and `@Permission`; the guard and the route-coverage test
  refuse any other count.
- **`GET /me` reports coarse permissions by asking the policy**, one `can()` per
  `(action, subject)` pair, so there is no second list to drift from `ability.ts`. The
  browser uses it to leave out a button; row-level refusals stay on the server.
- **Accounts are created by an operator CLI** (`user:create`), run with the owner
  connection like the migration job. Public sign-up is disabled, and with it disabled
  better-auth refuses the server-side sign-up call too, so the CLI builds an instance
  of its own that is bound to no socket.

## Options considered

- **Keep a signed token, stored in the browser.** No session table and no lookup per
  request. Not revocable before it expires, readable by any script on the page if kept
  in `localStorage`, and the roles inside it go stale.
- **Grant `athlete_app` what better-auth needs.** One role, one pool. It would give
  every statement the API runs read access to every tenant's password hashes and live
  session tokens, which is exactly what ADR 0004 withheld.
- **Upgrade `drizzle-orm` and use the adapter.** Rejected for now: an ORM upgrade is
  not something to fold into an authentication change, and the separate pool is wanted
  regardless.
- **Cache the session in a signed cookie** (better-auth's cookie cache). Saves the
  session read. Costs immediate revocation, which is the reason for having sessions.
- **A CSRF token** (double-submit or synchroniser). More moving parts in the SPA for
  no gain over an origin check on a same-origin application.
- **Sign-up, invitations, password reset by email.** All need outbound email, which
  this system does not have yet.

## Consequences

- **Good:** signing out, removing a role and removing a user all take effect on the
  next request, and each is one row. The privilege matrix still holds, now for two
  roles, and both halves are asserted against a real database
  (`privileges.matrix.integration`, `auth.session.integration`).
- **Cost: three reads before a handler runs** — the session (auth pool), the user's
  academies (application pool), and for a coach the teams they hold (tenant
  transaction). None is cached. At this system's scale that is the cheap side of the
  trade; if it stops being, the cookie cache is one option with a known price.
- **Cost: two pools against one database.** The auth pool is small (5 connections per
  replica) and has to be counted in connection budgets.
- **A defect found by writing it.** `app_academies_for_user()` is `SECURITY DEFINER`,
  so it reads as the schema owner, and both tables it reads are under `FORCE ROW LEVEL
  SECURITY`. With no tenant key the owner saw no rows, so the function returned nothing
  unless the owner was a superuser. It is one in a test container and in compose, and
  is not on a managed Postgres: every sign-in in production would have resolved to "no
  academy". `0003_auth.sql` gives the migrating role a `SELECT` policy on
  `user_academy_roles` and `academies`. What that concedes: the owner can now read role
  grants and academy names across tenants without setting a tenant key. Its writes are
  still confined, and `athlete_app` gains nothing. `auth.owner.integration` migrates as
  a non-superuser and fails if the policy is removed; no earlier suite could have,
  because all of them migrate as a superuser.
- **better-auth's routes are not ours.** `/api/auth/*` is mounted beneath Nest and
  passes through no guard, interceptor or filter of this API. Its errors are in the
  library's shape, not the `ApiError` contract, and it is absent from the route
  manifest. The SPA's auth client is the only caller.
- **Rate limiting on sign-in is the library's, in memory, per replica.** It is on in
  production and the smoke script observes it. With several replicas the effective
  allowance is multiplied by the replica count. It counts per client address, and
  behind Front Door and the Container Apps ingress `X-Forwarded-For` is a chain:
  better-auth trusts no address in a chain unless told which hops are proxies, and
  otherwise puts every caller in one shared bucket, where three attempts by anyone
  lock sign-in for everyone. So the API is given the proxies' ranges
  (`AUTH_TRUSTED_PROXIES`, from Terraform's Front Door backend service tag) and reads
  the chain right to left to the first address that is not one. Two limits: the ranges
  are a snapshot taken at apply time, and a request through a range Azure added since
  falls back to the shared bucket; and the origin is reachable directly, where a
  caller can write the header itself — it can then only spread its own attempts across
  buckets, not use anyone else's. Front Door's rate limit is the outer layer; neither
  is a lockout policy.
- **Password hashing is scrypt**, the library's default. argon2id remains a
  configuration change ([01 §7](../01-technology-stack.md#7-authentication--better-auth-users-in-our-own-postgres)).
- **A password given to the CLI with `--password` is visible in the process list.**
  Stdin is the default for that reason.
- **Not built:** password reset without an operator, email verification, TOTP,
  sign-out everywhere, any account management screen, and removing a user. The
  `auth_verifications` table exists because the library's schema requires it; nothing
  writes to it.
- **Unverified:** behaviour behind Front Door. `APP_BASE_URL` is wired through
  Terraform from the edge hostname and the cookie is `Secure` when that URL is https,
  but no request has travelled that path. In particular the shape of the forwarded
  chain (which hops appear, and whether the ingress adds one outside Front Door's
  ranges) is reasoned, not observed: check the address recorded on a session row on
  the first deploy.

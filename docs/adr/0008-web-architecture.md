# 8. The web client: thin routes, enforced features, and a policy that stays on the server

- **Status:** Accepted.
- **Date:** 2026-11-23

## Context

`apps/web` is a static React SPA for two roles, `academy_admin` and `coach`
([01 §6](../01-technology-stack.md#6-client--react--vite-spa-served-as-static-files)).
The API it talks to has structure that is enforced rather than agreed: layers checked
by dependency-cruiser, authorization declared per route, one error body. A client
written screen by screen loses that within a few features: each page fetches in its own
way, parses errors in its own way, and decides for itself who may see a button.

Three questions had to be answered once, before the second screen: where code goes,
who decides what a user may do, and what a failed request looks like.

## Decision

> **Routes are thin, features are closed, and four concerns exist exactly once: the API
> client, the error mapper, the permission check and the list table. The browser never
> holds the authorization policy; it holds the answer the server gave.**

- **One direction of dependency, checked in CI:** `routes → features → components →
  lib`. A route file holds a URL's search-params schema, its guard and its loader, and
  renders a feature page. A feature is `pages/`, `components/`, `hooks/` and an
  `index.ts`, which is its only public surface. A feature never imports another
  feature. Six dependency-cruiser rules (`pnpm run lint:boundaries`) make each of those
  a build failure.
- **What two features both need lives below them**, not in one of them: the pickers
  that choose an athlete or a team for another feature's form, the conflict dialog, the
  list table, the form bindings.
- **One app for both roles.** Roles are per academy, so the same person can be a coach
  in one and an administrator of another; two dashboards would be the wrong shape. The
  menu and the landing page follow the permissions of the active academy.
- **The policy stays on the server.** `GET /me` returns the coarse `(action, subject)`
  pairs the user holds in the active academy, computed by asking the one ability
  definition ([ADR 0002](./0002-casl-over-a-static-permission-map.md)). `can()` and
  `<Can>` read that list and decide only whether to draw a control the API would refuse
  for certain. Which rows a pair applies to is decided by the API on every request and
  arrives as a 403 or a 404. No CASL in the browser, no role names in components.
- **One error mapper.** Every failed call becomes one `ApiError`, and
  `handleApiError` is the only place that decides what a failure looks like: field
  messages on a form, the conflict dialog for a stale write, sign-in for a 401, one
  toast each for the rest. Screens do not parse errors.
- **Server state is the server's.** Lists are paged, sorted and searched by the API;
  their state lives in the URL, validated by the same list contract the API validates
  the query string with. Query keys are generated
  ([ADR 0007](./0007-generated-contract-pipeline.md)), never written.
- **A stale write has one answer:** the shared conflict dialog, showing only the fields
  in dispute, with "Keep mine" and "Take theirs".
- **Attendance is marked into a local draft and submitted once.** Each mark carries a
  `clientRecordId` made when the athlete is first touched and kept in local storage
  with the mark, keyed by user, academy and session. A reload restores it; a failed
  submission keeps it, so the retry sends the same ids and the API stores nothing
  twice; success deletes it.
- **Session reset.** Sign-out, an academy switch and a 401 clear the whole query cache
  and every local draft. What is cached was fetched as someone, or somewhere, else.
- **Same origin, no third party.** The SPA is served from the API's origin, so the
  session cookie is first-party and httpOnly and there is no token in JavaScript. Fonts
  are self-hosted; there is no analytics or error-reporting service. The end-to-end
  tests fail on a request to another host.
- **Stock design.** shadcn/ui's `dashboard-01`, light theme only, logical CSS classes
  throughout so the layout can be mirrored for Arabic. The brief does not assess
  frontend design, and a custom one would have been a cost with no claim behind it.

## Options considered

- **Two applications, one per role.** Simpler menus. Wrong for a person with two roles,
  and two of everything listed above.
- **Routes that own their screens** (the file-based router's default). Less
  indirection. Screens then import each other through the route tree and nothing can
  be checked about who depends on whom.
- **Ship the ability definition to the browser** (CASL on both sides). Buttons could
  follow row-level rules. It would also publish the policy, need the coach's resolved
  scope in the client, and create a second evaluation that can disagree with the
  first. The server's refusal is the control; a hidden button is a courtesy.
- **Per-screen error handling.** Each form free to word its own failures. The API has
  one error body precisely so that a client needs one handler.
- **Client-side tables** (fetch everything, sort and filter in memory). Less API. A
  full-table read per screen, and a `total` that would reveal rows outside a coach's
  scope if it were ever computed in the wrong place.
- **An offline queue with a service worker.** What pitch-side attendance eventually
  wants. Not built: it needs conflict rules for a register two devices filled in, and
  a requirement that has not been confirmed
  ([06](../06-decision-summary.md#open-questions-for-the-client), question 5). The
  draft and the idempotent write are the part of it that is cheap and already true.
- **Next.js or another server-rendered framework.** Rejected in 01 §6: a second
  deployable for an application with no public page.

## Consequences

- **Good:** a new screen is a route file and a feature folder, and gets the client, the
  error handling, the permission check and the table without writing any of them. The
  sessions feature was added without changing another feature.
- **Good:** nothing in the browser has to be right for access to be right. A user who
  edits the cached `/me` answer sees more buttons and gets the same refusals.
- **Cost: a control can be drawn that the API then refuses.** `can()` knows "a coach
  may update athletes", not "this athlete". The refusal arrives as a toast or a
  not-found page. The alternative is the second policy this record declines.
- **Cost: indirection for small things.** A two-line helper two features share has to
  be moved down a layer; a feature cannot reach into another for it.
- **Cost: a draft is on one device.** A register half-marked on a phone is not visible
  on a laptop, and it is deleted by sign-out. If the browser cannot write to local
  storage the marks live only as long as the page, and the screen says so.
- **Cost: a submission needs a connection.** The register tolerates a reload, a dead
  spot and a lost answer; it does not send by itself when the connection returns.
- **Limit: a register is submitted whole.** Every athlete still to record must be
  marked before the button is enabled, and a recorded entry cannot be corrected,
  because voiding has no route ([ADR 0004](./0004-privilege-matrix-and-voiding.md)).
- **Limit: two devices can fill in one register.** The database allows one active
  entry per athlete per session; the second submission is refused whole (409
  `attendance_already_recorded`), the screen reloads the register and the athletes
  still unmarked can be sent again.
- **Tested where it can fail:** the patterns by unit tests (the mapper's branches,
  `can`, drafts, the conflict dialog, the register), the flows by Playwright against
  the real stack (sign-in, a two-browser edit conflict, attendance at phone width with
  a reload and a submission whose answer is lost).

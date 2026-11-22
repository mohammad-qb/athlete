# 1. One `ApiError` taxonomy and one terminal error responder

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Two endpoints in this repository already disagreed about error bodies: `{ error,
message }` for a conflict, `{ error, issues }` for validation, and a bare framework
string for a 404. A client could not write one error handler. Worse, nothing decided
what an *unexpected* failure looked like on the wire, so whether a raw database error
reached a client depended on which layer happened to throw it.

## Decision

> **Every failure leaves the API through one responder, in one body shape. An error
> nobody classified is a 500, its message is redacted, and its cause is logged, never
> serialised.**

- **`ApiError`** carries `type` (the stable category a client switches on), `statusCode`
  and `logLevel` derived from it, and optional `code`, `meta`, `explanation` and
  `cause`. `toJSON()` omits `cause`, so a filter can attach a raw `pg` error without
  anyone having to judge whether it leaks.
- **`UNKNOWN` maps to 500, not 400.** The implementation this taxonomy was adapted
  from maps it to 400. That reports an unclassified server fault as the caller's
  mistake, and because severity derives from status, it logs at `warn` and keeps the
  fault out of error-level alerting: a service that is broken and quiet.
- **One `ErrorResponder`** logs once, at the error's own severity, with
  `event: 'http.request.failed'`, and writes the response. `meta` is logged for 5xx
  only, because 4xx `meta` echoes client input. The whole `cause` chain is logged,
  bounded and cycle-guarded: Drizzle wraps the driver's error, and the driver's
  message is the only step that says *why*.
- **Three filters feed it**, most specific last: `ApiError`; Nest's `HttpException`;
  everything else. A 5xx is always redacted to `"Internal server error"`, including a
  5xx `HttpException` — choosing a status is not a claim that the message is
  publishable. A 4xx `HttpException` publishes its message and nothing else of its
  payload; structured detail reaches the wire only through `ApiError.meta`.

## Options considered

- **Nest's `HttpException` family, thrown ad hoc** — the framework default, and what
  the slice did. Rejected as the contract: the status becomes the error's identity,
  each call site invents its body, and there is no `code` to switch on.
- **A subclass per error type** — rejected. The base maps every type to its status and
  severity, so most subclasses would add a name and nothing else.
- **Forwarding a 4xx exception's whole payload** (minus Nest's own keys) — how the
  first version worked, and what Nest's default filter does. Deleted rather than
  allow-listed: a guard or third-party exception that attaches internal state to a 4xx
  would publish it, and an allowlist of keys is brittle.

## Consequences

- **Good:** one error handler on the client; `type` and `code` are stable across
  message rewording; an unexpected failure cannot leak SQL, and still arrives in the
  log with its SQL, parameters and tenant id.
- **Cost:** a 503 says `"Internal server error"`. Nothing throws a 5xx deliberately
  today; the first endpoint that wants an honest "retry later" needs a 5xx-safe
  message allowlist and `Retry-After`, not a loosening of the redaction.
- **Not finished:** services still throw Nest's `NotFoundException` and
  `BadRequestException` in places. The filter normalises them to the same body, so the
  wire contract holds, but they carry no `code`. Converting them is mechanical.
- **Stated limit:** the responder logs through Nest's `Logger` with the structured
  fields appended as JSON. There is no structured logger or error tracker in the
  slice; swapping one in touches one method.
- **Asserted by:** `api-error.unit`, `error-responder.unit`, and the smoke script,
  which reads `type` and `code` out of real response bodies.

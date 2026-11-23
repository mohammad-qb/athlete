# Architecture decision records

One record per decision that would otherwise have to be re-derived from the code. Each
says what was decided, what it was decided against, and what it costs. The proposal in
[`docs/`](../) argues the design as a whole; these are the decisions made while
hardening the vertical slice and then building the web client on it, in the order they
were made.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-error-taxonomy-and-single-responder.md) | One `ApiError` taxonomy and one terminal error responder | Accepted |
| [0002](./0002-casl-over-a-static-permission-map.md) | CASL as the single authorization policy, over a static permission map | Accepted — reverses an earlier decision |
| [0003](./0003-flat-conditions-and-resolved-scope.md) | Flat rule conditions; coach scope resolved once per request | Accepted |
| [0004](./0004-privilege-matrix-and-voiding.md) | A database privilege matrix, and voiding instead of deleting | Accepted |
| [0005](./0005-terraform-privilege-split.md) | Terraform split by who applies it; a deploy identity that cannot touch IAM | Accepted — never applied |
| [0006](./0006-cookie-sessions-and-the-auth-role.md) | Cookie sessions as database rows; better-auth on its own database role | Accepted |
| [0007](./0007-generated-contract-pipeline.md) | One contract generated outwards: Zod, then OpenAPI, then the typed client | Accepted |
| [0008](./0008-web-architecture.md) | The web client: thin routes, enforced features, a policy that stays on the server | Accepted |

Two decisions of the same period are argued in the proposal itself rather than here:
validation on by default
([01 §10](../01-technology-stack.md#10-tooling-defaults-named),
[03 §4](../03-data-model.md#4-api-design)) and the type-aware lint gate
([01 §10](../01-technology-stack.md#10-tooling-defaults-named)).

The phase-by-phase record of how these were built, including every deviation from the
plan and every defect found on the way, is
[`plans/backend-foundations.md`](../plans/backend-foundations.md) for 0001 to 0005 and
[`plans/frontend-v1.md`](../plans/frontend-v1.md) from 0006.

## Shape

`# N. Title`, then **Status** and **Date**, then *Context*, *Decision*, *Options
considered*, *Consequences*. A record is not edited to change its decision: a later
record supersedes it and both say so.

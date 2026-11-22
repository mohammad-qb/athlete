#!/usr/bin/env bash
#
# End-to-end smoke check against a running stack.
#
# This exists because the integration suite -- which asserts the database guarantees
# directly -- cannot catch wiring faults. Two real bugs were found by this check and by
# nothing else: a middleware registered on the Express 5 path '*' that silently never
# ran (making every authenticated request return 401), and an id validator stricter
# than the database's own uuid type. Database tests and wiring tests catch different
# classes of defect, so this repository keeps both.
#
# Usage:
#   POSTGRES_PORT=55432 API_PORT=3100 docker compose up -d --build
#   POSTGRES_PORT=55432 docker compose run --rm migrate
#   API_PORT=3100 ./scripts/smoke.sh
set -uo pipefail

API_PORT="${API_PORT:-3000}"
BASE="http://localhost:${API_PORT}/api/v1"
export SESSION_SECRET="${SESSION_SECRET:-local-development-secret-at-least-32-chars}"

ACADEMY_A=11111111-1111-1111-1111-111111111111
ACADEMY_B=22222222-2222-2222-2222-222222222222
ATHLETE=44444444-4444-4444-4444-444444444444

fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  PASS  %-44s %s\n' "$1" "$3"
  else
    printf '  FAIL  %-44s got %s, expected %s\n' "$1" "$3" "$2"
    fail=1
  fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
etag_shape() {
  case "$1" in
    '') echo missing ;;
    *[!0-9]*) echo "not-an-integer: $1" ;;
    *) echo integer ;;
  esac
}
# One field out of an error body. The error contract is a single shape for every
# failure (apps/api/src/common/errors), so a smoke check can assert the body and not
# only the status -- which is where the contract actually lives.
field() { # field <json-path-key> <curl args...>
  local key="$1"; shift
  curl -s "$@" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s)[process.argv[1]]))}catch{process.stdout.write("<unparseable>")}})' "$key"
}

echo "Seeding demo data..."
docker compose exec -T postgres psql -U postgres -d athlete -q < scripts/seed-demo.sql > /dev/null

TOKEN_A=$(node scripts/mint-token.js "$ACADEMY_A")
TOKEN_B=$(node scripts/mint-token.js "$ACADEMY_B")
A="Authorization: Bearer $TOKEN_A"
B="Authorization: Bearer $TOKEN_B"
JSON='Content-Type: application/json'

echo
echo "Liveness and deny-by-default"
check "health is public"               200  "$(code "$BASE/health")"
check "no token is refused"            401  "$(code "$BASE/athletes")"

echo
echo "Tenant isolation over HTTP (identical request, different academy)"
check "academy A sees its athletes"    200  "$(code -H "$A" "$BASE/athletes")"
check "academy B sees an empty list"   "[]" "$(curl -s -H "$B" "$BASE/athletes")"
check "A's athlete is invisible to B"  404  "$(code -H "$B" "$BASE/athletes/$ATHLETE")"

echo
echo "Optimistic concurrency"
ETAG=$(curl -s -D- -o /dev/null -H "$A" "$BASE/athletes/$ATHLETE" | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r"')
# Asserts the SHAPE, not the value. The version is whatever the row is at, and this
# script must be re-runnable against a database it has already written to -- an earlier
# assertion that the first read returns version 0 passed only against a virgin volume
# and failed on the second run, which is a check that tests the fixture rather than the
# behaviour.
check "read returns an ETag"           integer "$(etag_shape "$ETAG")"
check "write with current ETag wins"   200  "$(code -X PATCH -H "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Ali"}' "$BASE/athletes/$ATHLETE")"
check "stale write is refused"         409  "$(code -X PATCH -H "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Omar"}' "$BASE/athletes/$ATHLETE")"
check "write without If-Match refused" 400  "$(code -X PATCH -H "$A" -H "$JSON" -d '{"lastName":"Y"}' "$BASE/athletes/$ATHLETE")"

echo
echo "Error contract (one shape for every failure, not just a status code)"
check "conflict is typed CONFLICT"     CONFLICT       "$(field type -X PATCH -H "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Omar"}' "$BASE/athletes/$ATHLETE")"
check "conflict carries a stable code" stale_write    "$(field code -X PATCH -H "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Omar"}' "$BASE/athletes/$ATHLETE")"
check "a refusal is typed NOT_FOUND"   NOT_FOUND      "$(field type -H "$B" "$BASE/athletes/$ATHLETE")"
check "no token is typed UNAUTHORIZED" UNAUTHORIZED   "$(field type "$BASE/athletes")"

echo
echo "Validation"
check "malformed body is refused"      400  "$(code -X POST -H "$A" -H "$JSON" -d '{"firstName":"","lastName":"Z","dateOfBirth":"nope"}' "$BASE/athletes")"
check "malformed id is refused"        400  "$(code -H "$A" "$BASE/athletes/not-a-uuid")"
check "validation is typed BAD_REQUEST" BAD_REQUEST "$(field type -H "$A" "$BASE/athletes/not-a-uuid")"

echo
if [ $fail -eq 0 ]; then
  echo "All smoke checks passed."
else
  echo "Smoke checks FAILED."
fi
exit $fail

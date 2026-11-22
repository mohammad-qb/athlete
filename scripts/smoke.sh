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
# better-auth's own routes: beside the versioned API, not under it.
AUTH="http://localhost:${API_PORT}/api/auth"
# The origin the stack was told the browser uses (APP_BASE_URL in docker-compose.yml).
ORIGIN="http://localhost:${API_PORT}"
export SEED_PASSWORD="${SEED_PASSWORD:-athlete-dev-password}"

ACADEMY_A=11111111-1111-1111-1111-111111111111
ACADEMY_B=22222222-2222-2222-2222-222222222222
ATHLETE=44444444-4444-4444-4444-444444444444
TEAM_A=66666666-6666-6666-6666-666666666666
TEAM_B=77777777-7777-7777-7777-777777777777

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

# The API refuses to start until the database is migrated and it is connected as the
# application role, and compose restarts it until then -- so straight after
# `docker compose run --rm migrate` it may still be on its way up.
printf 'Waiting for the API'
for _ in $(seq 1 30); do
  [ "$(code "$BASE/health")" = 200 ] && break
  printf '.'; sleep 2
done
echo

echo "Seeding demo data and accounts..."
# Academies, teams, athletes, and Alpha's administrator and coach.
./scripts/seed-dev.sh > /dev/null || { echo "seed-dev.sh failed"; exit 1; }

# Two more people, through the same operator CLI: Beta's administrator, and someone who
# belongs to both academies -- the case switching academy exists for.
create_user() { # create_user <email> <name> <academy> <role>
  printf '%s' "$SEED_PASSWORD" |
    docker compose run --rm -T migrate node dist/cli/create-user.js \
      --email "$1" --name "$2" --academy "$3" --role "$4" > /dev/null 2>&1
}
create_user admin@beta.test 'Beta Admin' "$ACADEMY_B" academy_admin
create_user both@alpha.test 'Both Academies' "$ACADEMY_A" coach
create_user both@alpha.test 'Both Academies' "$ACADEMY_B" academy_admin

JSON='Content-Type: application/json'
JARS=$(mktemp -d)
trap 'rm -rf "$JARS"' EXIT

# One sign-in attempt: prints the status, keeps the session cookie in a jar. The Origin
# header is what a browser sends; better-auth checks it on its routes.
try_sign_in() { # try_sign_in <jar> <email> [password]
  curl -s -o /dev/null -w '%{http_code}' -c "$1" -H "$JSON" -H "Origin: $ORIGIN" \
    -d "{\"email\":\"$2\",\"password\":\"${3:-$SEED_PASSWORD}\"}" "$AUTH/sign-in/email"
}
# Signs in as the SPA will, waiting out better-auth's sign-in rate limit (a few attempts
# per ten seconds per client address) instead of switching it off: this script signs
# several people in from one address, which is exactly what the limit is there to slow.
sign_in() { # sign_in <jar> <email> [password]
  local status
  for _ in $(seq 1 8); do
    status=$(try_sign_in "$@")
    [ "$status" = 429 ] || break
    sleep 3
  done
  printf '%s' "$status"
}
# One expression out of a JSON body: jq-less, like `field` above.
json() { # json <js expression over `d`> <curl args...>
  local expr="$1"; shift
  curl -s "$@" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(String(eval(process.argv[1])))}catch{process.stdout.write("<unparseable>")}})' "$expr"
}

# The jars stand where the bearer tokens stood: -b "$A" is "as Alpha's administrator".
A="$JARS/admin-a"; B="$JARS/admin-b"; C="$JARS/coach"; M="$JARS/both"

echo
echo "Signing in (a session row behind an httpOnly cookie)"
check "wrong password is refused"       401  "$(sign_in "$JARS/wrong" admin@alpha.test not-the-password)"
check "Alpha's administrator signs in"  200  "$(sign_in "$A" admin@alpha.test)"
check "Beta's administrator signs in"   200  "$(sign_in "$B" admin@beta.test)"
check "the coach signs in"              200  "$(sign_in "$C" coach@alpha.test)"
check "the cookie is httpOnly"          1    "$(grep -c '^#HttpOnly_.*athlete\.session_token' "$A")"
# Guessing passwords is slowed down by the library, per client address. Asserted as
# "a burst ends in 429", not as a count: the exact allowance is better-auth's to choose.
burst=""; for _ in 1 2 3 4 5 6; do burst="$burst $(try_sign_in "$JARS/wrong" admin@alpha.test not-the-password)"; done
check "a burst of sign-ins is rate limited" 429 "${burst##* }"
check "public sign-up is closed"        false "$(json 'd.user !== undefined' -H "$JSON" -H "Origin: $ORIGIN" -d '{"email":"intruder@example.test","name":"Intruder","password":"a-long-enough-password"}' "$AUTH/sign-up/email")"

echo
echo "Liveness and deny-by-default"
check "health is public"               200  "$(code "$BASE/health")"
check "no cookie is refused"           401  "$(code "$BASE/athletes")"
check "a made-up cookie is refused"    401  "$(code -H 'Cookie: athlete.session_token=made.up' "$BASE/athletes")"

echo
echo "Tenant isolation over HTTP (identical request, different academy)"
check "academy A sees its athletes"    200  "$(code -b "$A" "$BASE/athletes")"
check "academy B sees an empty list"   "[]" "$(curl -s -b "$B" "$BASE/athletes")"
check "A's athlete is invisible to B"  404  "$(code -b "$B" "$BASE/athletes/$ATHLETE")"

echo
echo "Resource scoping inside one academy (a coach of team A; team B exists beside it)"
# The administrator's list above holds both athletes. The coach's holds exactly the one
# on the team they coach -- asserted as the id list, so an unfiltered query fails here.
check "coach lists only their team's athletes" "$ATHLETE" "$(curl -s -b "$C" "$BASE/athletes" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).map(a=>a.id).join(","))}catch{process.stdout.write("<unparseable>")}})')"
check "coach is refused team B's roster"  403  "$(code -b "$C" "$BASE/teams/$TEAM_B/roster")"

echo
echo "Optimistic concurrency"
ETAG=$(curl -s -D- -o /dev/null -b "$A" "$BASE/athletes/$ATHLETE" | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r"')
# Asserts the SHAPE, not the value. The version is whatever the row is at, and this
# script must be re-runnable against a database it has already written to -- an earlier
# assertion that the first read returns version 0 passed only against a virgin volume
# and failed on the second run, which is a check that tests the fixture rather than the
# behaviour.
check "read returns an ETag"           integer "$(etag_shape "$ETAG")"
check "write with current ETag wins"   200  "$(code -X PATCH -b "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Ali"}' "$BASE/athletes/$ATHLETE")"
check "stale write is refused"         409  "$(code -X PATCH -b "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Omar"}' "$BASE/athletes/$ATHLETE")"
check "write without If-Match refused" 400  "$(code -X PATCH -b "$A" -H "$JSON" -d '{"lastName":"Y"}' "$BASE/athletes/$ATHLETE")"

echo
echo "Error contract (one shape for every failure, not just a status code)"
check "conflict is typed CONFLICT"     CONFLICT       "$(field type -X PATCH -b "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Omar"}' "$BASE/athletes/$ATHLETE")"
check "conflict carries a stable code" stale_write    "$(field code -X PATCH -b "$A" -H "If-Match: \"$ETAG\"" -H "$JSON" -d '{"lastName":"Falcon-Omar"}' "$BASE/athletes/$ATHLETE")"
check "a refusal is typed NOT_FOUND"   NOT_FOUND      "$(field type -b "$B" "$BASE/athletes/$ATHLETE")"
check "no cookie is typed UNAUTHORIZED" UNAUTHORIZED  "$(field type "$BASE/athletes")"

echo
echo "Validation (on by default; a 200 never means \"nothing happened\")"
etag() { curl -s -D- -o /dev/null -b "$A" "$BASE/athletes/$ATHLETE" | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r"'; }
# First field path out of a validation failure's meta.fields.
field_path() { curl -s "$@" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).meta.fields.map(f=>f.in+":"+f.path).join(",")))}catch{process.stdout.write("<unparseable>")}})'; }

check "malformed body is refused"      400  "$(code -X POST -b "$A" -H "$JSON" -d '{"firstName":"","lastName":"Z","dateOfBirth":"nope"}' "$BASE/athletes")"
check "malformed id is refused"        400  "$(code -b "$A" "$BASE/athletes/not-a-uuid")"
check "validation is typed VALIDATION" VALIDATION "$(field type -b "$A" "$BASE/athletes/not-a-uuid")"
check "the failing field is named"     "params:id" "$(field_path -b "$A" "$BASE/athletes/not-a-uuid")"

# The silent no-op. A misspelled field used to be stripped, leaving an empty patch that
# "succeeded": 200, version bumped, every other client's ETag stale, nothing changed.
# Sent with the CURRENT ETag, so the only thing that can refuse it is validation.
BEFORE=$(etag)
check "misspelled field is refused"    400  "$(code -X PATCH -b "$A" -H "If-Match: \"$BEFORE\"" -H "$JSON" -d '{"dateofBirth":"2010-01-01"}' "$BASE/athletes/$ATHLETE")"
check "...and names the field"         "body:dateofBirth" "$(field_path -X PATCH -b "$A" -H "If-Match: \"$BEFORE\"" -H "$JSON" -d '{"dateofBirth":"2010-01-01"}' "$BASE/athletes/$ATHLETE")"
check "empty patch is refused"         400  "$(code -X PATCH -b "$A" -H "If-Match: \"$BEFORE\"" -H "$JSON" -d '{}' "$BASE/athletes/$ATHLETE")"
# Compared together with its shape: two identical non-answers must not count as "unchanged".
AFTER=$(etag)
check "the ETag did not move"          "$BEFORE integer" "$AFTER $(etag_shape "$AFTER")"

# An unparseable ?at used to reach the driver as an Invalid Date and come back as a 500.
check "garbage query value is a 400"   400  "$(code -b "$A" "$BASE/teams/$TEAM_A/roster?at=garbage")"
check "a valid instant is accepted"    200  "$(code -b "$A" "$BASE/teams/$TEAM_A/roster?at=2026-01-01T00:00:00Z")"
check "unknown query parameter refused" 400 "$(code -b "$A" "$BASE/teams/$TEAM_A/roster?when=now")"

echo
echo "Who am I (GET /me: academies, and the coarse permissions of the active one)"
me() { json "$1" -b "$2" "$BASE/me"; }
check "/me needs a session"            401  "$(code "$BASE/me")"
check "/me names the signed-in user"   admin@alpha.test "$(me 'd.user.email' "$A")"
check "...their academies and roles"   "Alpha Academy:academy_admin" "$(me 'd.academies.map(a=>a.name+":"+a.roles.join("+")).join(",")' "$A")"
check "...and the active academy"      "$ACADEMY_A" "$(me 'd.activeAcademyId' "$A")"
has() { me "d.permissions.some(p=>p.action+' '+p.subject==='$1')" "$2"; }
check "an admin may create athletes"   true  "$(has 'create athletes' "$A")"
check "a coach may not"                false "$(has 'create athletes' "$C")"
check "a coach may record attendance"  true  "$(has 'create sessionParticipants' "$C")"
check "the wildcard is never reported" false "$(me 'd.permissions.some(p=>p.action==="manage")' "$A")"

echo
echo "Switching academy (the server chooses; the browser asks)"
switch() { # switch <jar> <academy> [origin]  -- prints the status
  code -X POST -b "$1" -H "$JSON" -H "Origin: ${3:-$ORIGIN}" -d "{\"academyId\":\"$2\"}" "$BASE/me/active-academy"
}
check "member of both signs in"            200  "$(sign_in "$M" both@alpha.test)"
check "starts in the first academy by name" "$ACADEMY_A" "$(me 'd.activeAcademyId' "$M")"
check "...as a coach there"                false "$(has 'create athletes' "$M")"
check "switches to the other academy"      200  "$(switch "$M" "$ACADEMY_B")"
check "the session moved"                  "$ACADEMY_B" "$(me 'd.activeAcademyId' "$M")"
check "...with the roles held THERE"       true  "$(has 'create athletes' "$M")"
check "...and sees that academy's data"    "[]" "$(curl -s -b "$M" "$BASE/athletes")"
check "an academy that is not theirs is 403" 403 "$(switch "$A" "$ACADEMY_B")"
check "...typed not_a_member"              not_a_member "$(field code -X POST -b "$A" -H "$JSON" -H "Origin: $ORIGIN" -d "{\"academyId\":\"$ACADEMY_B\"}" "$BASE/me/active-academy")"
check "...and the session did not move"    "$ACADEMY_A" "$(me 'd.activeAcademyId' "$A")"
# The browser cannot set it through better-auth's own session route either.
curl -s -o /dev/null -X POST -b "$A" -H "$JSON" -H "Origin: $ORIGIN" -d "{\"activeAcademyId\":\"$ACADEMY_B\"}" "$AUTH/update-session"
check "update-session cannot choose a tenant" "$ACADEMY_A" "$(me 'd.activeAcademyId' "$A")"

echo
echo "Origin check (a cookie is ambient; a state-changing request must say where it is from)"
EVIL='Origin: https://evil.example'
NEW_ATHLETE='{"firstName":"Cross","lastName":"Site","dateOfBirth":"2010-01-01"}'
check "POST from a foreign origin is 403"   403  "$(code -X POST -b "$A" -H "$JSON" -H "$EVIL" -d "$NEW_ATHLETE" "$BASE/athletes")"
check "...typed invalid_origin"             invalid_origin "$(field code -X POST -b "$A" -H "$JSON" -H "$EVIL" -d "$NEW_ATHLETE" "$BASE/athletes")"
check "...and nothing was written"          0    "$(json 'd.filter(a=>a.lastName==="Site").length' -b "$A" "$BASE/athletes")"
check "a foreign-origin GET is not refused" 200  "$(code -b "$A" -H "$EVIL" "$BASE/athletes")"
check "the application's own origin passes" 200  "$(switch "$A" "$ACADEMY_A")"
check "better-auth refuses it on its routes" 403 "$(code -X POST -b "$A" -H "$JSON" -H "$EVIL" -d '{}' "$AUTH/sign-out")"
check "...and the session survived that"    200  "$(code -b "$A" "$BASE/me")"

echo
echo "Signing out (the row is deleted, so a copied cookie is worth nothing)"
cp "$A" "$JARS/stolen"
check "sign-out succeeds"              200  "$(code -X POST -b "$A" -c "$A" -H "$JSON" -H "Origin: $ORIGIN" -d '{}' "$AUTH/sign-out")"
check "the old cookie is refused"      401  "$(code -b "$JARS/stolen" "$BASE/me")"
check "...on every route"              401  "$(code -b "$JARS/stolen" "$BASE/athletes")"
check "another session is unaffected"  200  "$(code -b "$C" "$BASE/me")"

echo
if [ $fail -eq 0 ]; then
  echo "All smoke checks passed."
else
  echo "Smoke checks FAILED."
fi
exit $fail

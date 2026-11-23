#!/usr/bin/env bash
#
# Seeds the compose database for manual use: the demo academies, teams and athletes of
# scripts/seed-demo.sql, plus three people who can sign in.
#
#   admin@alpha.test   academy_admin of Alpha Academy
#   coach@alpha.test   coach in Alpha Academy, assigned to Team A
#   both@alpha.test    coach in Alpha Academy AND academy_admin of Beta Academy:
#                      the account to try the academy switcher with
#
# All share one password: $SEED_PASSWORD, or the default below. LOCAL USE ONLY.
#
# Accounts are created with the operator CLI, in the migrate container, because that is
# the only way an account comes to exist: public sign-up is disabled and neither service
# role may write both `users` and `user_academy_roles`. Re-runnable: an existing account
# keeps its password and is only (re)granted its role.
#
# Usage, with the stack up and migrated:
#   docker compose up -d --build && docker compose run --rm migrate
#   ./scripts/seed-dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SEED_PASSWORD="${SEED_PASSWORD:-athlete-dev-password}"
ACADEMY_A=11111111-1111-1111-1111-111111111111
ACADEMY_B=22222222-2222-2222-2222-222222222222
TEAM_A=66666666-6666-6666-6666-666666666666

run_sql() { docker compose exec -T postgres psql -U postgres -d athlete -q -v ON_ERROR_STOP=1 "$@"; }

# create_user <email> <name> <academy> <role>  -- prints the user's id.
# The password goes in on stdin, so it is in no process list and no shell history.
create_user() {
  printf '%s' "$SEED_PASSWORD" |
    docker compose run --rm -T migrate node dist/cli/create-user.js \
      --email "$1" --name "$2" --academy "$3" --role "$4" | tail -n 1 | tr -d '\r'
}

echo "Seeding academies, teams and athletes..."
run_sql < scripts/seed-demo.sql > /dev/null

echo "Creating accounts..."
create_user admin@alpha.test 'Alpha Admin' "$ACADEMY_A" academy_admin > /dev/null
COACH_ID=$(create_user coach@alpha.test 'Alpha Coach' "$ACADEMY_A" coach)
create_user both@alpha.test 'Both Academies' "$ACADEMY_A" coach > /dev/null
create_user both@alpha.test 'Both Academies' "$ACADEMY_B" academy_admin > /dev/null

# The coach coaches Team A only; Team B exists beside it, which is what makes a coach's
# scope observable. Fixed id, so running this twice does not open a second assignment.
run_sql > /dev/null <<SQL
begin;
select set_config('app.current_academy_id', '$ACADEMY_A', true);
insert into team_coach_assignments (id, academy_id, team_id, coach_user_id, valid_from)
values ('99999999-9999-9999-9999-999999999993', '$ACADEMY_A', '$TEAM_A', '$COACH_ID', '2026-01-01T00:00:00Z')
on conflict (id) do nothing;
commit;
SQL

echo "Done. Sign in as admin@alpha.test, coach@alpha.test or both@alpha.test with the seed password."

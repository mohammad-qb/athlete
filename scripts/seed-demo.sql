-- Minimal demo data: two academies, so tenant isolation is observable over HTTP, and
-- two teams in the first, so a coach's scope is.
--
-- Run as the superuser because there is no academy-creation endpoint in this slice --
-- onboarding is a platform-admin flow that is documented rather than built -- and
-- because the application role cannot do it: it holds SELECT only on academies and
-- role grants, and nothing on users (0002_grants.sql).
begin;

insert into users (id, email, password_hash, full_name)
values ('33333333-3333-3333-3333-333333333333', 'admin@alpha.test', 'x', 'Alpha Admin')
on conflict do nothing;

select set_config('app.current_academy_id', '11111111-1111-1111-1111-111111111111', true);

insert into academies (id, name)
values ('11111111-1111-1111-1111-111111111111', 'Alpha Academy')
on conflict do nothing;

insert into user_academy_roles (academy_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'academy_admin')
on conflict do nothing;

insert into athletes (id, academy_id, first_name, last_name, date_of_birth)
values ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'Amal', 'Falcon', '2008-01-01')
on conflict do nothing;

-- A coach and two teams. The coach is assigned to team A only; each team has one
-- athlete. Fixed ids throughout so the script is re-runnable.
insert into users (id, email, password_hash, full_name)
values ('55555555-5555-5555-5555-555555555555', 'coach@alpha.test', 'x', 'Alpha Coach')
on conflict do nothing;

insert into user_academy_roles (academy_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'coach')
on conflict do nothing;

insert into teams (id, academy_id, name, sport)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Team A', 'football'),
       ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', 'Team B', 'football')
on conflict do nothing;

insert into athletes (id, academy_id, first_name, last_name, date_of_birth)
values ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'Bilal', 'Oryx', '2008-06-01')
on conflict do nothing;

insert into team_memberships (id, academy_id, team_id, athlete_id, valid_from)
values ('99999999-9999-9999-9999-999999999991', '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', '2026-01-01T00:00:00Z'),
       ('99999999-9999-9999-9999-999999999992', '11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888', '2026-01-01T00:00:00Z')
on conflict (id) do nothing;

insert into team_coach_assignments (id, academy_id, team_id, coach_user_id, valid_from)
values ('99999999-9999-9999-9999-999999999993', '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', '55555555-5555-5555-5555-555555555555', '2026-01-01T00:00:00Z')
on conflict (id) do nothing;

select set_config('app.current_academy_id', '22222222-2222-2222-2222-222222222222', true);

insert into academies (id, name)
values ('22222222-2222-2222-2222-222222222222', 'Beta Academy')
on conflict do nothing;

commit;

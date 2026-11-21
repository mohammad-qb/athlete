-- Minimal demo data: two academies, so tenant isolation is observable over HTTP.
--
-- Run as the superuser (which bypasses RLS) because there is no academy-creation
-- endpoint in this slice -- academy onboarding is a platform-admin flow that is
-- documented rather than built. set_config is still used so the inserts would also
-- succeed as the application role.
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

select set_config('app.current_academy_id', '22222222-2222-2222-2222-222222222222', true);

insert into academies (id, name)
values ('22222222-2222-2222-2222-222222222222', 'Beta Academy')
on conflict do nothing;

commit;

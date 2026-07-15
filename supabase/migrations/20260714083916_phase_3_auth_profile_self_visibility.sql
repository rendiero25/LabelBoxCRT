-- An inactive user needs to read only their own profile state so the server
-- can deny access with a deterministic inactive-account result. All other
-- application tables remain restricted by the active-role policy helpers.
drop policy profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated
using (
  (select private.is_active_admin())
  or id = (select auth.uid())
);

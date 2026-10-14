-- Protech Resto · botón "Quitar" del panel Admin Protech
-- Quita a un usuario del local (borra su fila en resto_miembros). NO elimina su cuenta de Supabase.
-- Solo puede usarla un usuario con rol protech_admin.
create or replace function public.resto_quitar_usuario(p_email text, p_local uuid) returns integer language plpgsql security definer set search_path = public, auth as $$
declare n integer;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'protech_admin' then raise exception 'No autorizado'; end if;
  delete from public.resto_miembros where local_id = p_local and user_id in (select id from auth.users where lower(email) = lower(p_email));
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.resto_quitar_usuario(text, uuid) from public, anon;
grant execute on function public.resto_quitar_usuario(text, uuid) to authenticated;

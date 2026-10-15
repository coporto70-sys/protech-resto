-- Protech Resto · acceso "Carlos Oporto – Ingeniero de Software"
-- La clave se guarda SOLO en la base (cifrada con bcrypt). No queda escrita en el código ni en GitHub.
--
-- ANTES DE EJECUTAR: cambia  CAMBIA_ESTA_CLAVE  (línea del insert) por la clave que quieras usar.
-- Para cambiarla después: vuelve a ejecutar solo el bloque "update" del final con la nueva clave.

create extension if not exists pgcrypto;

create table if not exists public.resto_ingeniero (
  id int primary key default 1 check (id = 1),
  clave_hash text not null,
  intentos int not null default 0,
  bloqueado_hasta timestamptz
);
alter table public.resto_ingeniero enable row level security;
-- Sin políticas: nadie puede leer ni escribir la tabla desde la app; solo la función de abajo.

insert into public.resto_ingeniero (id, clave_hash)
values (1, crypt('CAMBIA_ESTA_CLAVE', gen_salt('bf')))
on conflict (id) do nothing;

-- Verifica la clave. Solo responde true/false. Tras 5 fallos seguidos bloquea 15 minutos.
create or replace function public.resto_verificar_ingeniero(p_clave text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare r public.resto_ingeniero%rowtype; ok boolean;
begin
  if auth.uid() is null then return false; end if;
  select * into r from public.resto_ingeniero where id = 1 for update;
  if not found then return false; end if;
  if r.bloqueado_hasta is not null and r.bloqueado_hasta > now() then return false; end if;
  ok := r.clave_hash = crypt(coalesce(p_clave, ''), r.clave_hash);
  if ok then
    update public.resto_ingeniero set intentos = 0, bloqueado_hasta = null where id = 1;
  else
    update public.resto_ingeniero
      set intentos = case when intentos >= 4 then 0 else intentos + 1 end,
          bloqueado_hasta = case when intentos >= 4 then now() + interval '15 minutes' else null end
      where id = 1;
  end if;
  return ok;
end $$;

revoke all on function public.resto_verificar_ingeniero(text) from public, anon;
grant execute on function public.resto_verificar_ingeniero(text) to authenticated;

-- Para CAMBIAR la clave más adelante, ejecuta solo esto:
-- update public.resto_ingeniero set clave_hash = crypt('NUEVA_CLAVE', gen_salt('bf')), intentos = 0, bloqueado_hasta = null where id = 1;

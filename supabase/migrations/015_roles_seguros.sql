-- Protech Resto · 015 · Roles y PIN aplicados en la base de datos
--
-- Antes: el PIN se verificaba en el navegador y su "huella" estaba a la vista de cualquiera con la cuenta del local.
-- Ahora: el PIN se verifica en el servidor (bcrypt, con bloqueo tras 5 intentos) y entrega un pase de sesión.
-- La base solo acepta ciertas escrituras (carta, garzones, locales, inventario de producción, caja, gastos) si el pase corresponde al rol.
--
-- Compatibilidad: si el local no tiene PIN de administradora, TODO sigue funcionando como antes (sin roles).
-- Es idempotente: se puede ejecutar más de una vez.

create extension if not exists pgcrypto;

create table if not exists public.resto_migraciones (
  nombre text primary key,
  aplicada_at timestamptz not null default now()
);

-- ============ Credenciales (nadie puede leerlas desde la app) ============
create table if not exists public.resto_credenciales (
  local_id uuid not null,
  rol text not null check (rol in ('admin', 'garzon', 'cocina')),
  ref text not null,              -- 'admin' | id del garzón | id de la cocinera
  hash text,                      -- bcrypt
  legacy text,                    -- huella antigua (sha256), se reemplaza por bcrypt en el primer ingreso correcto
  actualizado_at timestamptz not null default now(),
  primary key (local_id, rol, ref)
);
create table if not exists public.resto_rol_sesion (
  token_hash text primary key,
  local_id uuid not null,
  rol text not null,              -- admin | garzon | cocina | ingeniero
  ref text,
  quien text,
  caja boolean not null default false,
  temporal boolean not null default false,
  creada_at timestamptz not null default now(),
  expira timestamptz not null
);
create table if not exists public.resto_pin_intentos (
  local_id uuid not null,
  clave text not null,
  fallos int not null default 0,
  bloqueado_hasta timestamptz,
  primary key (local_id, clave)
);
alter table public.resto_credenciales enable row level security;
alter table public.resto_rol_sesion enable row level security;
alter table public.resto_pin_intentos enable row level security;
-- Sin políticas: solo las funciones de abajo pueden tocar estas tablas.

-- Pasa las claves antiguas a la tabla protegida y deja solo una marca en las columnas visibles
insert into public.resto_credenciales (local_id, rol, ref, legacy)
  select id, 'admin', 'admin', admin_pin from public.resto_locales
  where coalesce(admin_pin, '') not in ('', 'bcrypt')
  on conflict do nothing;
update public.resto_locales set admin_pin = 'bcrypt' where coalesce(admin_pin, '') not in ('', 'bcrypt');

insert into public.resto_credenciales (local_id, rol, ref, legacy)
  select local_id, 'garzon', id::text, pin from public.resto_garzones
  where coalesce(pin, '') not in ('', 'bcrypt')
  on conflict do nothing;
update public.resto_garzones set pin = 'bcrypt' where coalesce(pin, '') not in ('', 'bcrypt');

insert into public.resto_credenciales (local_id, rol, ref, legacy)
  select local_id, 'cocina', id::text, pin from public.resto_cocineras
  where coalesce(pin, '') not in ('', 'bcrypt')
  on conflict do nothing;
update public.resto_cocineras set pin = 'bcrypt' where coalesce(pin, '') not in ('', 'bcrypt');

-- ============ Quién es quien llama ============
create or replace function public.resto_token_actual() returns text
language sql stable as $$
  select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-rol-token', '')
$$;

create or replace function public.resto_rol_actual() returns text
language sql stable security definer set search_path = public, extensions as $$
  select s.rol from public.resto_rol_sesion s
  where s.token_hash = encode(digest(public.resto_token_actual(), 'sha256'), 'hex')
    and s.expira > now() and s.local_id = public.resto_mi_local()
  limit 1
$$;
create or replace function public.resto_quien_actual() returns text
language sql stable security definer set search_path = public, extensions as $$
  select s.quien from public.resto_rol_sesion s
  where s.token_hash = encode(digest(public.resto_token_actual(), 'sha256'), 'hex')
    and s.expira > now() and s.local_id = public.resto_mi_local()
  limit 1
$$;
create or replace function public.resto_caja_actual() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select s.caja from public.resto_rol_sesion s
  where s.token_hash = encode(digest(public.resto_token_actual(), 'sha256'), 'hex')
    and s.expira > now() and s.local_id = public.resto_mi_local()
  limit 1), false)
$$;
create or replace function public.resto_roles_on() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.resto_credenciales c where c.local_id = public.resto_mi_local() and c.rol = 'admin')
      or exists (select 1 from public.resto_locales l where l.id = public.resto_mi_local() and coalesce(l.admin_pin, '') <> '')
$$;
-- ¿Puede este llamado hacer una acción reservada a esos roles? (el ingeniero equivale a administradora)
create or replace function public.resto_puede(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.resto_roles_on()
      or coalesce(public.resto_rol_actual() = 'ingeniero' or public.resto_rol_actual() = any (p_roles), false)
$$;
create or replace function public.resto_puede_caja() returns boolean
language sql stable security definer set search_path = public as $$
  select not public.resto_roles_on()
      or coalesce(public.resto_rol_actual() in ('admin', 'ingeniero') or (public.resto_rol_actual() = 'garzon' and public.resto_caja_actual()), false)
$$;

-- ============ Ingreso con PIN ============
create or replace function public.resto_login(p_rol text, p_ref text, p_pin text default '', p_temp boolean default false) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_local uuid := public.resto_mi_local();
  c public.resto_credenciales%rowtype;
  it public.resto_pin_intentos%rowtype;
  v_key text := coalesce(p_rol, '') || ':' || coalesce(p_ref, '');
  v_quien text; v_caja boolean := false; v_ok boolean := false; v_tok text; v_dur interval; v_scope text;
begin
  if auth.uid() is null or v_local is null then return json_build_object('ok', false, 'error', 'sin_local'); end if;
  if p_rol not in ('admin', 'garzon', 'cocina') then return json_build_object('ok', false, 'error', 'rol'); end if;

  if p_rol = 'admin' then v_quien := 'Administradora'; v_scope := 'admin';
  elsif p_rol = 'garzon' then
    select nombre, coalesce(caja, true) into v_quien, v_caja from public.resto_garzones where id::text = p_ref and local_id = v_local and coalesce(activo, true);
    v_scope := 'g:' || coalesce(p_ref, '');
  else
    select nombre into v_quien from public.resto_cocineras where id::text = p_ref and local_id = v_local and coalesce(activo, true);
    v_scope := 'c:' || coalesce(p_ref, '');
  end if;
  if v_quien is null then return json_build_object('ok', false, 'error', 'no_existe'); end if;

  select * into it from public.resto_pin_intentos where local_id = v_local and clave = v_key for update;
  if found and it.bloqueado_hasta is not null and it.bloqueado_hasta > now() then
    return json_build_object('ok', false, 'error', 'bloqueado', 'hasta', it.bloqueado_hasta);
  end if;

  select * into c from public.resto_credenciales where local_id = v_local and rol = p_rol and ref = p_ref for update;
  if not found then
    if p_rol = 'admin' then return json_build_object('ok', false, 'error', 'sin_pin'); end if;
    v_ok := coalesce(p_pin, '') = '';      -- garzón o cocinera sin PIN: entra sin PIN, sin caja
    v_caja := false;
  else
    if c.hash is not null then
      v_ok := c.hash = crypt(coalesce(p_pin, ''), c.hash);
    elsif c.legacy is not null then
      v_ok := c.legacy = encode(digest(v_local::text || ':' || v_scope || ':' || coalesce(p_pin, ''), 'sha256'), 'hex');
      if v_ok then
        update public.resto_credenciales set hash = crypt(p_pin, gen_salt('bf')), legacy = null, actualizado_at = now()
         where local_id = v_local and rol = p_rol and ref = p_ref;
      end if;
    end if;
  end if;

  if not v_ok then
    insert into public.resto_pin_intentos (local_id, clave, fallos) values (v_local, v_key, 1)
    on conflict (local_id, clave) do update set
      fallos = case when public.resto_pin_intentos.fallos >= 4 then 0 else public.resto_pin_intentos.fallos + 1 end,
      bloqueado_hasta = case when public.resto_pin_intentos.fallos >= 4 then now() + interval '10 minutes' else null end;
    return json_build_object('ok', false, 'error', 'pin');
  end if;

  delete from public.resto_pin_intentos where local_id = v_local and clave = v_key;
  if p_rol <> 'garzon' then v_caja := false; end if;
  v_dur := case when p_temp then interval '3 minutes' when p_rol = 'cocina' then interval '30 days' else interval '16 hours' end;
  v_tok := encode(gen_random_bytes(24), 'hex');
  delete from public.resto_rol_sesion where expira < now() - interval '1 day';
  insert into public.resto_rol_sesion (token_hash, local_id, rol, ref, quien, caja, temporal, expira)
    values (encode(digest(v_tok, 'sha256'), 'hex'), v_local, p_rol, p_ref, v_quien, v_caja, p_temp, now() + v_dur);
  return json_build_object('ok', true, 'token', v_tok, 'quien', v_quien, 'rol', p_rol, 'caja', v_caja);
end $$;

create or replace function public.resto_login_ing(p_clave text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare v_local uuid := public.resto_mi_local(); v_tok text;
begin
  if auth.uid() is null or v_local is null then return json_build_object('ok', false, 'error', 'sin_local'); end if;
  if not coalesce(public.resto_verificar_ingeniero(p_clave), false) then return json_build_object('ok', false, 'error', 'pin'); end if;
  v_tok := encode(gen_random_bytes(24), 'hex');
  insert into public.resto_rol_sesion (token_hash, local_id, rol, quien, caja, temporal, expira)
    values (encode(digest(v_tok, 'sha256'), 'hex'), v_local, 'ingeniero', 'Carlos Oporto', true, false, now() + interval '16 hours');
  return json_build_object('ok', true, 'token', v_tok, 'quien', 'Carlos Oporto', 'rol', 'ingeniero', 'caja', true);
end $$;

-- ¿Sigue válido mi pase? (y lo renueva si es de uso normal)
create or replace function public.resto_sesion_estado() returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s public.resto_rol_sesion%rowtype; h text := encode(digest(public.resto_token_actual(), 'sha256'), 'hex');
begin
  select * into s from public.resto_rol_sesion where token_hash = h and expira > now() and local_id = public.resto_mi_local();
  if not found then return null; end if;
  if not s.temporal and s.rol <> 'cocina' then
    update public.resto_rol_sesion set expira = greatest(expira, now() + interval '16 hours') where token_hash = h;
  end if;
  return json_build_object('rol', s.rol, 'quien', s.quien, 'caja', s.caja);
end $$;

create or replace function public.resto_logout() returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.resto_rol_sesion where token_hash = encode(digest(public.resto_token_actual(), 'sha256'), 'hex')
$$;

-- Crear, cambiar o quitar un PIN (pin vacío = quitar). Solo administradora; la primera vez (sin PIN de administradora) cualquiera del local.
create or replace function public.resto_pin_set(p_rol text, p_ref text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_local uuid := public.resto_mi_local(); v_pin text := coalesce(p_pin, '');
begin
  if auth.uid() is null or v_local is null then raise exception 'Sin local'; end if;
  if p_rol not in ('admin', 'garzon', 'cocina') then raise exception 'Rol no válido'; end if;
  if not (p_rol = 'admin' and not public.resto_roles_on()) and not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede cambiar los PIN';
  end if;
  if v_pin <> '' and v_pin !~ '^\d{4,8}$' then raise exception 'El PIN debe tener entre 4 y 8 números'; end if;
  if v_pin = '' then
    delete from public.resto_credenciales where local_id = v_local and rol = p_rol and ref = p_ref;
    delete from public.resto_pin_intentos where local_id = v_local and clave = p_rol || ':' || p_ref;
    if p_rol = 'admin' then update public.resto_locales set admin_pin = null where id = v_local;
    elsif p_rol = 'garzon' then update public.resto_garzones set pin = null, caja = false where id::text = p_ref and local_id = v_local;
    else update public.resto_cocineras set pin = null where id::text = p_ref and local_id = v_local; end if;
  else
    insert into public.resto_credenciales (local_id, rol, ref, hash, legacy) values (v_local, p_rol, p_ref, crypt(v_pin, gen_salt('bf')), null)
    on conflict (local_id, rol, ref) do update set hash = excluded.hash, legacy = null, actualizado_at = now();
    delete from public.resto_pin_intentos where local_id = v_local and clave = p_rol || ':' || p_ref;
    if p_rol = 'admin' then update public.resto_locales set admin_pin = 'bcrypt' where id = v_local;
    elsif p_rol = 'garzon' then update public.resto_garzones set pin = 'bcrypt' where id::text = p_ref and local_id = v_local;
    else update public.resto_cocineras set pin = 'bcrypt' where id::text = p_ref and local_id = v_local; end if;
  end if;
end $$;

revoke all on function public.resto_login(text, text, text, boolean) from public, anon;
revoke all on function public.resto_login_ing(text) from public, anon;
revoke all on function public.resto_sesion_estado() from public, anon;
revoke all on function public.resto_logout() from public, anon;
revoke all on function public.resto_pin_set(text, text, text) from public, anon;
grant execute on function public.resto_login(text, text, text, boolean) to authenticated;
grant execute on function public.resto_login_ing(text) to authenticated;
grant execute on function public.resto_sesion_estado() to authenticated;
grant execute on function public.resto_logout() to authenticated;
grant execute on function public.resto_pin_set(text, text, text) to authenticated;

-- ============ Políticas por rol ============
-- Carta
drop policy if exists p_menu on public.resto_menu;
drop policy if exists p_menu_sel on public.resto_menu;
drop policy if exists p_menu_ins on public.resto_menu;
drop policy if exists p_menu_upd on public.resto_menu;
drop policy if exists p_menu_del on public.resto_menu;
create policy p_menu_sel on public.resto_menu for select using (local_id = resto_mi_local());
create policy p_menu_ins on public.resto_menu for insert with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
create policy p_menu_upd on public.resto_menu for update using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
create policy p_menu_del on public.resto_menu for delete using (local_id = resto_mi_local() and public.resto_puede(array['admin']));
-- Las ventas descuentan stock (cualquier rol); lo demás de la carta (nombre, precio, estación, activo…) solo la administradora
create or replace function public.resto_menu_proteger() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'stock') is distinct from (to_jsonb(old) - 'stock') and not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede cambiar la carta (nombre, precio, estación o stock mínimo)';
  end if;
  return new;
end $$;
create or replace trigger resto_menu_proteger before update on public.resto_menu
  for each row execute function public.resto_menu_proteger();

-- Garzones y cocineras
drop policy if exists resto_garzones_local on public.resto_garzones;
drop policy if exists p_garz_sel on public.resto_garzones;
drop policy if exists p_garz_mod on public.resto_garzones;
create policy p_garz_sel on public.resto_garzones for select using (local_id = resto_mi_local());
create policy p_garz_mod on public.resto_garzones for all using (local_id = resto_mi_local() and public.resto_puede(array['admin'])) with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
drop policy if exists p_cocineras on public.resto_cocineras;
drop policy if exists p_coc_sel on public.resto_cocineras;
drop policy if exists p_coc_mod on public.resto_cocineras;
create policy p_coc_sel on public.resto_cocineras for select using (local_id = resto_mi_local());
create policy p_coc_mod on public.resto_cocineras for all using (local_id = resto_mi_local() and public.resto_puede(array['admin'])) with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));

-- Local (mesas, sencillo fijo, QR, PIN)
drop policy if exists p_loc on public.resto_locales;
drop policy if exists p_loc_sel on public.resto_locales;
drop policy if exists p_loc_upd on public.resto_locales;
create policy p_loc_sel on public.resto_locales for select using (id = resto_mi_local());
create policy p_loc_upd on public.resto_locales for update using (id = resto_mi_local() and public.resto_puede(array['admin'])) with check (id = resto_mi_local() and public.resto_puede(array['admin']));

-- Caja: abrir, cerrar y gastos solo administradora o garzón autorizado con PIN
drop policy if exists p_turnos on public.resto_turnos;
drop policy if exists p_turnos_sel on public.resto_turnos;
drop policy if exists p_turnos_mod on public.resto_turnos;
create policy p_turnos_sel on public.resto_turnos for select using (local_id = resto_mi_local());
create policy p_turnos_mod on public.resto_turnos for all using (local_id = resto_mi_local() and public.resto_puede_caja()) with check (local_id = resto_mi_local() and public.resto_puede_caja());

drop policy if exists p_gastos_ins on public.resto_gastos;
drop policy if exists p_gastos_upd on public.resto_gastos;
create policy p_gastos_ins on public.resto_gastos for insert with check (local_id = resto_mi_local() and public.resto_puede_caja());
create policy p_gastos_upd on public.resto_gastos for update using (local_id = resto_mi_local() and public.resto_puede_caja()) with check (local_id = resto_mi_local() and public.resto_puede_caja());
-- Solo la administradora autoriza una anulación (quien está en caja solo puede pedirla)
create or replace function public.resto_gastos_inmutable() returns trigger
language plpgsql as $$
begin
  if new.local_id is distinct from old.local_id or new.turno_id is distinct from old.turno_id
     or new.tipo is distinct from old.tipo or new.numero is distinct from old.numero
     or new.proveedor is distinct from old.proveedor or new.detalle is distinct from old.detalle
     or new.monto is distinct from old.monto or new.registrado_por is distinct from old.registrado_por
     or new.created_at is distinct from old.created_at then
    raise exception 'Un gasto registrado no se puede modificar, solo anular';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un gasto anulado no se puede reactivar';
  end if;
  if new.anulado and not old.anulado and not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede autorizar la anulación de un gasto';
  end if;
  return new;
end $$;

-- Inventario de producción: solo administradora
drop policy if exists p_insumos on public.resto_insumos;
drop policy if exists p_insumos_sel on public.resto_insumos;
drop policy if exists p_insumos_mod on public.resto_insumos;
create policy p_insumos_sel on public.resto_insumos for select using (local_id = resto_mi_local());
create policy p_insumos_mod on public.resto_insumos for all using (local_id = resto_mi_local() and public.resto_puede(array['admin'])) with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
drop policy if exists p_insumo_mov_ins on public.resto_insumo_mov;
create policy p_insumo_mov_ins on public.resto_insumo_mov for insert with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));

-- Cuentas cobradas: se pueden crear (no cocina) pero nadie las edita ni las borra desde la app
drop policy if exists p_cue on public.resto_cuentas;
drop policy if exists p_cue_sel on public.resto_cuentas;
drop policy if exists p_cue_ins on public.resto_cuentas;
create policy p_cue_sel on public.resto_cuentas for select using (local_id = resto_mi_local());
create policy p_cue_ins on public.resto_cuentas for insert with check (local_id = resto_mi_local() and public.resto_puede(array['admin', 'garzon']));

-- Anulaciones: cualquiera las pide; aprobar o rechazar solo administradora (o cafetería, que sale directo)
drop policy if exists p_anulaciones on public.resto_anulaciones;
drop policy if exists p_anu_sel on public.resto_anulaciones;
drop policy if exists p_anu_ins on public.resto_anulaciones;
drop policy if exists p_anu_upd on public.resto_anulaciones;
create policy p_anu_sel on public.resto_anulaciones for select using (local_id = resto_mi_local());
create policy p_anu_ins on public.resto_anulaciones for insert with check (local_id = resto_mi_local()
  and (estado = 'pendiente' or estacion = 'cafeteria' or public.resto_puede(array['admin'])));
create policy p_anu_upd on public.resto_anulaciones for update using (local_id = resto_mi_local())
  with check (local_id = resto_mi_local() and (estado = 'pendiente' or estacion = 'cafeteria' or public.resto_puede(array['admin'])));

insert into public.resto_migraciones (nombre) values ('015_roles_seguros') on conflict do nothing;

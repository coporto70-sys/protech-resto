-- Protech Resto · 032 · Pedido por QR con confirmación, estado en vivo y avisos de la mesa
--
-- Antes: el pedido del cliente caía directo en cocina.
-- Ahora, cada pedido por QR queda registrado y el cliente puede ver en qué va (recibido → confirmado → en camino → entregado).
-- Si el local activa "confirmar pedidos QR", el pedido espera "por confirmar" y solo pasa a cocina cuando la caja
-- (administradora o garzón) lo acepta; si lo rechaza, el stock reservado se devuelve.
-- El cliente también puede tocar "Llamar al garzón" o "Pedir la cuenta" desde su mesa.
--
-- Solo AGREGA columnas, tablas, funciones y disparadores. No borra ni modifica datos existentes.
-- El comportamiento actual no cambia hasta que la administradora active la confirmación (por defecto apagada).
-- Es idempotente: se puede ejecutar más de una vez.

alter table public.resto_locales  add column if not exists qr_confirmar boolean not null default false;
alter table public.resto_comandas add column if not exists qr_pedido_id uuid;

-- Pedidos hechos por QR (el cliente no lee esta tabla: solo consulta su pedido por el id que recibe al enviarlo)
create table if not exists public.resto_qr_pedidos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  mesa integer not null,
  items jsonb not null,                       -- [{"id","n","q","p","e"}] con precios tomados de la base
  nota text,
  nombre text,
  estado text not null default 'por_confirmar' check (estado in ('por_confirmar', 'confirmado', 'rechazado')),
  motivo text,
  resuelto_por text,
  resuelto_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists resto_qr_pedidos_local on public.resto_qr_pedidos (local_id, estado, created_at desc);
create index if not exists resto_comandas_qr on public.resto_comandas (qr_pedido_id) where qr_pedido_id is not null;

-- Avisos de la mesa: llamar al garzón o pedir la cuenta
create table if not exists public.resto_qr_avisos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  mesa integer not null,
  tipo text not null check (tipo in ('garzon', 'cuenta')),
  atendido boolean not null default false,
  atendido_por text,
  atendido_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists resto_qr_avisos_local on public.resto_qr_avisos (local_id, atendido, created_at desc);

alter table public.resto_qr_pedidos enable row level security;
alter table public.resto_qr_avisos  enable row level security;
drop policy if exists p_qr_pedidos on public.resto_qr_pedidos;
create policy p_qr_pedidos on public.resto_qr_pedidos for all
  using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
drop policy if exists p_qr_avisos on public.resto_qr_avisos;
create policy p_qr_avisos on public.resto_qr_avisos for all
  using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());

do $$ begin alter publication supabase_realtime add table public.resto_qr_pedidos; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resto_qr_avisos;  exception when others then null; end $$;

-- ============ Funciones internas (nadie las llama desde afuera) ============

-- Crea las comandas (cocina y cafetería por separado) de un pedido QR ya aceptado
create or replace function public.resto_qr_a_comandas(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p record; coc jsonb; caf jsonb;
begin
  select * into p from public.resto_qr_pedidos where id = p_pedido;
  if not found then return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('n', x->>'n', 'q', (x->>'q')::int, 'p', (x->>'p')::numeric, 'e', 'cocina')), '[]'::jsonb)
    into coc from jsonb_array_elements(p.items) x where coalesce(x->>'e', 'cocina') <> 'cafeteria';
  select coalesce(jsonb_agg(jsonb_build_object('n', x->>'n', 'q', (x->>'q')::int, 'p', (x->>'p')::numeric, 'e', 'cafeteria')), '[]'::jsonb)
    into caf from jsonb_array_elements(p.items) x where x->>'e' = 'cafeteria';
  if jsonb_array_length(coc) > 0 then
    insert into public.resto_comandas(local_id, mesa, items, nota, garzon, estado, qr_pedido_id)
    values (p.local_id, p.mesa, coc, p.nota, null, 'pendiente', p.id);
  end if;
  if jsonb_array_length(caf) > 0 then
    insert into public.resto_comandas(local_id, mesa, items, nota, garzon, estado, qr_pedido_id)
    values (p.local_id, p.mesa, caf, p.nota, null, 'pendiente', p.id);
  end if;
end $$;

-- Devuelve al stock lo reservado por un pedido que no se confirmó
create or replace function public.resto_qr_devolver_stock(p_pedido uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p record; it jsonb;
begin
  select * into p from public.resto_qr_pedidos where id = p_pedido;
  if not found then return; end if;
  for it in select * from jsonb_array_elements(p.items) loop
    update public.resto_menu set stock = stock + (it->>'q')::int
     where id = (it->>'id')::uuid and local_id = p.local_id and stock is not null;
  end loop;
end $$;

-- Un pedido que nadie confirmó en 30 minutos se cancela solo y devuelve su stock
create or replace function public.resto_qr_vencer(p_local uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.resto_qr_pedidos
            where local_id = p_local and estado = 'por_confirmar' and created_at < now() - interval '30 minutes'
            for update skip locked loop
    update public.resto_qr_pedidos set estado = 'rechazado', motivo = 'Nadie lo confirmó a tiempo', resuelto_por = 'Sistema', resuelto_at = now() where id = r.id;
    perform public.resto_qr_devolver_stock(r.id);
  end loop;
end $$;

revoke all on function public.resto_qr_a_comandas(uuid)      from public, anon, authenticated;
revoke all on function public.resto_qr_devolver_stock(uuid)  from public, anon, authenticated;
revoke all on function public.resto_qr_vencer(uuid)          from public, anon, authenticated;

-- ============ Menú público: ahora avisa si el local confirma los pedidos ============
create or replace function public.resto_qr_menu(p_local uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select id, nombre, mesas, coalesce(mesas2, 0) as mesas2, qr_activo, qr_confirmar into l from public.resto_locales where id = p_local;
  if not found then return jsonb_build_object('error', 'no_existe'); end if;
  if not l.qr_activo then return jsonb_build_object('error', 'qr_inactivo', 'nombre', l.nombre); end if;
  return jsonb_build_object(
    'nombre', l.nombre, 'mesas', l.mesas, 'mesas2', l.mesas2, 'confirmar', coalesce(l.qr_confirmar, false),
    'menu', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'n', m.nombre, 'c', m.categoria, 'p', m.precio,
               'e', case when m.estacion = 'cafeteria' then 'cafeteria' else 'cocina' end) order by m.categoria, m.nombre)
        from public.resto_menu m
       where m.local_id = p_local and m.activo and (m.stock is null or m.stock > 0)
    ), '[]'::jsonb));
end $$;

-- ============ Enviar un pedido desde la mesa ============
-- Antes devolvía {"ok":true}. Ahora devuelve además el id del pedido y su estado (el celular lo usa para mostrar el avance).
create or replace function public.resto_qr_pedir(p_local uuid, p_mesa integer, p_items jsonb, p_nota text default '', p_nombre text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l record; it jsonb; m record; mid uuid; q integer;
  lista jsonb := '[]'::jsonb;
  nota text; recientes integer; pendientes integer; nuevo uuid; est text;
begin
  select id, mesas, coalesce(mesas2, 0) as mesas2, qr_activo, qr_confirmar into l from public.resto_locales where id = p_local;
  if not found or not l.qr_activo then raise exception 'qr_inactivo'; end if;
  if not ((p_mesa between 1 and l.mesas) or (p_mesa between 101 and 100 + l.mesas2)) then raise exception 'mesa_invalida'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    raise exception 'pedido_invalido';
  end if;

  perform public.resto_qr_vencer(p_local);

  -- freno contra abuso: máximo 4 pedidos por mesa cada 2 minutos y 30 esperando confirmación en el local
  select count(*) into recientes from public.resto_qr_pedidos
   where local_id = p_local and mesa = p_mesa and created_at > now() - interval '2 minutes';
  if recientes >= 4 then raise exception 'demasiados_pedidos'; end if;
  select count(*) into pendientes from public.resto_qr_pedidos where local_id = p_local and estado = 'por_confirmar';
  if pendientes >= 30 then raise exception 'demasiados_pedidos'; end if;

  nota := '📱 Pedido QR'
    || case when nullif(trim(coalesce(p_nombre, '')), '') is not null then ' · ' || left(trim(p_nombre), 30) else '' end
    || case when nullif(trim(coalesce(p_nota, '')), '') is not null then ' · ' || left(trim(p_nota), 200) else '' end;

  for it in select * from jsonb_array_elements(p_items) loop
    begin
      mid := (it ->> 'id')::uuid;
      q := (it ->> 'q')::integer;
    exception when others then raise exception 'pedido_invalido';
    end;
    if q is null or q < 1 or q > 20 then raise exception 'pedido_invalido'; end if;

    select * into m from public.resto_menu where id = mid and local_id = p_local and activo;
    if not found then raise exception 'no_disponible'; end if;

    -- stock atómico: si no alcanza, se cancela TODO el pedido
    if m.stock is not null then
      update public.resto_menu set stock = stock - q where id = m.id and stock >= q;
      if not found then raise exception 'sin_stock:%', m.nombre; end if;
    end if;

    lista := lista || jsonb_build_array(jsonb_build_object('id', m.id, 'n', m.nombre, 'q', q, 'p', m.precio,
               'e', case when m.estacion = 'cafeteria' then 'cafeteria' else 'cocina' end));
  end loop;

  est := case when coalesce(l.qr_confirmar, false) then 'por_confirmar' else 'confirmado' end;
  insert into public.resto_qr_pedidos(local_id, mesa, items, nota, nombre, estado)
  values (p_local, p_mesa, lista, nota, nullif(left(trim(coalesce(p_nombre, '')), 30), ''), est)
  returning id into nuevo;

  if est = 'confirmado' then perform public.resto_qr_a_comandas(nuevo); end if;
  return jsonb_build_object('ok', true, 'pedido', nuevo, 'estado', est);
end $$;

-- ============ Estado del pedido (lo consulta el celular del cliente) ============
-- fase: 1 recibido · 2 confirmado y en preparación · 3 en camino · 4 entregado
create or replace function public.resto_qr_estado(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record; n integer; pend integer; list integer; fase integer;
begin
  select * into p from public.resto_qr_pedidos where id = p_pedido;
  if not found then return jsonb_build_object('error', 'no_existe'); end if;
  if p.estado = 'por_confirmar' and p.created_at < now() - interval '30 minutes' then
    perform public.resto_qr_vencer(p.local_id);
    select * into p from public.resto_qr_pedidos where id = p_pedido;
  end if;
  if p.estado = 'rechazado' then return jsonb_build_object('estado', 'rechazado', 'fase', 1, 'motivo', coalesce(p.motivo, '')); end if;
  if p.estado = 'por_confirmar' then return jsonb_build_object('estado', 'por_confirmar', 'fase', 1); end if;
  select count(*), count(*) filter (where estado = 'pendiente'), count(*) filter (where estado = 'listo')
    into n, pend, list from public.resto_comandas where qr_pedido_id = p_pedido;
  fase := case when n = 0 then 2 when pend > 0 then 2 when list > 0 then 3 else 4 end;
  return jsonb_build_object('estado', 'confirmado', 'fase', fase);
end $$;

-- ============ Avisos de la mesa ============
create or replace function public.resto_qr_avisar(p_local uuid, p_mesa integer, p_tipo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; ya integer; recientes integer;
begin
  select id, mesas, coalesce(mesas2, 0) as mesas2, qr_activo into l from public.resto_locales where id = p_local;
  if not found or not l.qr_activo then raise exception 'qr_inactivo'; end if;
  if not ((p_mesa between 1 and l.mesas) or (p_mesa between 101 and 100 + l.mesas2)) then raise exception 'mesa_invalida'; end if;
  if p_tipo not in ('garzon', 'cuenta') then raise exception 'pedido_invalido'; end if;

  -- si ya hay un aviso igual esperando, no se duplica
  select count(*) into ya from public.resto_qr_avisos
   where local_id = p_local and mesa = p_mesa and tipo = p_tipo and not atendido and created_at > now() - interval '30 minutes';
  if ya > 0 then return jsonb_build_object('ok', true, 'ya', true); end if;

  select count(*) into recientes from public.resto_qr_avisos
   where local_id = p_local and mesa = p_mesa and created_at > now() - interval '5 minutes';
  if recientes >= 4 then raise exception 'demasiados_avisos'; end if;

  insert into public.resto_qr_avisos(local_id, mesa, tipo) values (p_local, p_mesa, p_tipo);

  -- "Pedir la cuenta" deja la mesa marcada como cuenta pedida (igual que cuando la pide el garzón)
  if p_tipo = 'cuenta' then
    update public.resto_comandas set cuenta_pedida_at = now()
     where local_id = p_local and mesa = p_mesa and not cerrada and cuenta_pedida_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============ Acciones del personal (confirmar, rechazar, atender) ============
create or replace function public.resto_qr_confirmar(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.resto_puede(array['admin', 'garzon']) then raise exception 'Solo la administradora o un garzón puede confirmar pedidos QR'; end if;
  select * into p from public.resto_qr_pedidos where id = p_pedido and local_id = public.resto_mi_local() for update;
  if not found then raise exception 'pedido_no_existe'; end if;
  if p.estado <> 'por_confirmar' then return jsonb_build_object('ok', true, 'ya', p.estado); end if;   -- otra persona ya lo resolvió
  update public.resto_qr_pedidos set estado = 'confirmado', resuelto_por = coalesce(public.resto_quien_actual(), 'Caja'), resuelto_at = now() where id = p_pedido;
  perform public.resto_qr_a_comandas(p_pedido);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.resto_qr_rechazar(p_pedido uuid, p_motivo text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  if not public.resto_puede(array['admin', 'garzon']) then raise exception 'Solo la administradora o un garzón puede rechazar pedidos QR'; end if;
  select * into p from public.resto_qr_pedidos where id = p_pedido and local_id = public.resto_mi_local() for update;
  if not found then raise exception 'pedido_no_existe'; end if;
  if p.estado <> 'por_confirmar' then return jsonb_build_object('ok', true, 'ya', p.estado); end if;
  update public.resto_qr_pedidos set estado = 'rechazado', motivo = nullif(left(trim(coalesce(p_motivo, '')), 120), ''),
         resuelto_por = coalesce(public.resto_quien_actual(), 'Caja'), resuelto_at = now() where id = p_pedido;
  perform public.resto_qr_devolver_stock(p_pedido);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.resto_qr_atender(p_aviso uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.resto_puede(array['admin', 'garzon']) then raise exception 'Sin permiso para atender avisos'; end if;
  update public.resto_qr_avisos set atendido = true, atendido_por = coalesce(public.resto_quien_actual(), 'Salón'), atendido_at = now()
   where id = p_aviso and local_id = public.resto_mi_local() and not atendido;
  return jsonb_build_object('ok', true);
end $$;

-- Permisos: el cliente (sin cuenta) solo puede pedir, ver el estado de SU pedido y avisar desde su mesa
revoke all on function public.resto_qr_menu(uuid)                                   from public;
revoke all on function public.resto_qr_pedir(uuid, integer, jsonb, text, text)      from public;
revoke all on function public.resto_qr_estado(uuid)                                 from public;
revoke all on function public.resto_qr_avisar(uuid, integer, text)                  from public;
revoke all on function public.resto_qr_confirmar(uuid)                              from public, anon;
revoke all on function public.resto_qr_rechazar(uuid, text)                         from public, anon;
revoke all on function public.resto_qr_atender(uuid)                                from public, anon;
grant execute on function public.resto_qr_menu(uuid)                                to anon, authenticated;
grant execute on function public.resto_qr_pedir(uuid, integer, jsonb, text, text)   to anon, authenticated;
grant execute on function public.resto_qr_estado(uuid)                              to anon, authenticated;
grant execute on function public.resto_qr_avisar(uuid, integer, text)               to anon, authenticated;
grant execute on function public.resto_qr_confirmar(uuid)                           to authenticated;
grant execute on function public.resto_qr_rechazar(uuid, text)                      to authenticated;
grant execute on function public.resto_qr_atender(uuid)                             to authenticated;

-- ============ Avisos push a la administradora (usa la misma función de la 022) ============
create or replace function public.resto_push_qr_pedido() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'por_confirmar' then
    perform public.resto_push_enviar(new.local_id, 'Pedido QR por confirmar',
      public.resto_mesa_txt(new.mesa) || ' · ' || (select coalesce(sum((x->>'q')::int), 0) from jsonb_array_elements(new.items) x) || ' productos',
      'qrp-' || new.id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_push_qr_pedido on public.resto_qr_pedidos;
create trigger resto_push_qr_pedido after insert on public.resto_qr_pedidos
  for each row execute function public.resto_push_qr_pedido();

create or replace function public.resto_push_qr_aviso() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.resto_push_enviar(new.local_id,
    case when new.tipo = 'cuenta' then 'Mesa pide la cuenta' else 'Mesa llama al garzón' end,
    public.resto_mesa_txt(new.mesa) || case when new.tipo = 'cuenta' then ' pidió la cuenta desde el QR' else ' necesita atención' end,
    'qra-' || new.id);
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_push_qr_aviso on public.resto_qr_avisos;
create trigger resto_push_qr_aviso after insert on public.resto_qr_avisos
  for each row execute function public.resto_push_qr_aviso();

insert into public.resto_migraciones (nombre) values ('032_qr_confirmar') on conflict do nothing;

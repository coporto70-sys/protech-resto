-- Protech Resto · pedido por QR (el cliente pide desde su mesa, sin cuenta)
-- Solo AGREGA una columna y 2 funciones. No borra ni modifica datos existentes.
-- Seguridad: el cliente NO lee ni escribe tablas directamente. Solo puede llamar a estas dos funciones,
-- que validan todo en el servidor (precios y stock salen de la base, nunca del celular del cliente).

-- El local decide si activa el pedido por QR (por defecto apagado)
alter table public.resto_locales add column if not exists qr_activo boolean not null default false;

-- 1) Menú público de un local (solo si tiene el QR activado): platos disponibles y con stock
create or replace function public.resto_qr_menu(p_local uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select id, nombre, mesas, coalesce(mesas2, 0) as mesas2, qr_activo into l from public.resto_locales where id = p_local;
  if not found then return jsonb_build_object('error', 'no_existe'); end if;
  if not l.qr_activo then return jsonb_build_object('error', 'qr_inactivo', 'nombre', l.nombre); end if;
  return jsonb_build_object(
    'nombre', l.nombre, 'mesas', l.mesas, 'mesas2', l.mesas2,
    'menu', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'n', m.nombre, 'c', m.categoria, 'p', m.precio,
               'e', case when m.estacion = 'cafeteria' then 'cafeteria' else 'cocina' end) order by m.categoria, m.nombre)
        from public.resto_menu m
       where m.local_id = p_local and m.activo and (m.stock is null or m.stock > 0)
    ), '[]'::jsonb));
end $$;

-- 2) Enviar un pedido desde una mesa. p_items = [{"id":"<uuid del plato>","q":2}, ...]
create or replace function public.resto_qr_pedir(p_local uuid, p_mesa integer, p_items jsonb, p_nota text default '', p_nombre text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l record; it jsonb; m record; mid uuid; q integer;
  coc jsonb := '[]'::jsonb; caf jsonb := '[]'::jsonb;
  nota text; recientes integer;
begin
  select id, mesas, coalesce(mesas2, 0) as mesas2, qr_activo into l from public.resto_locales where id = p_local;
  if not found or not l.qr_activo then raise exception 'qr_inactivo'; end if;
  if not ((p_mesa between 1 and l.mesas) or (p_mesa between 101 and 100 + l.mesas2)) then raise exception 'mesa_invalida'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 40 then
    raise exception 'pedido_invalido';
  end if;

  -- freno contra abuso: máximo 4 pedidos por mesa cada 2 minutos
  select count(*) into recientes from public.resto_comandas
   where local_id = p_local and mesa = p_mesa and nota like '📱%' and created_at > now() - interval '2 minutes';
  if recientes >= 4 then raise exception 'demasiados_pedidos'; end if;

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

    if m.estacion = 'cafeteria' then
      caf := caf || jsonb_build_array(jsonb_build_object('n', m.nombre, 'q', q, 'p', m.precio, 'e', 'cafeteria'));
    else
      coc := coc || jsonb_build_array(jsonb_build_object('n', m.nombre, 'q', q, 'p', m.precio, 'e', 'cocina'));
    end if;
  end loop;

  if jsonb_array_length(coc) > 0 then
    insert into public.resto_comandas(local_id, mesa, items, nota, garzon, estado) values (p_local, p_mesa, coc, nota, null, 'pendiente');
  end if;
  if jsonb_array_length(caf) > 0 then
    insert into public.resto_comandas(local_id, mesa, items, nota, garzon, estado) values (p_local, p_mesa, caf, nota, null, 'pendiente');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- El cliente (sin cuenta) solo puede ejecutar estas dos funciones
revoke all on function public.resto_qr_menu(uuid) from public;
revoke all on function public.resto_qr_pedir(uuid, integer, jsonb, text, text) from public;
grant execute on function public.resto_qr_menu(uuid) to anon, authenticated;
grant execute on function public.resto_qr_pedir(uuid, integer, jsonb, text, text) to anon, authenticated;

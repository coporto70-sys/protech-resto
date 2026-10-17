-- Protech Resto · recetas con descuento automático, proveedores, órdenes de compra y vencimientos.
-- Solo AGREGA tablas, una columna y una función. No borra ni modifica datos. Seguro de ejecutar más de una vez.

-- Vencimiento (fecha) de cada insumo
alter table public.resto_insumos add column if not exists vence date;

-- Receta: cuánto de cada insumo se gasta por cada unidad vendida de un producto
create table if not exists public.resto_recetas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  menu_id uuid not null,
  insumo_id uuid not null,
  cantidad numeric not null check (cantidad > 0),
  created_at timestamptz not null default now(),
  unique (menu_id, insumo_id)
);
create index if not exists resto_recetas_local_idx on public.resto_recetas (local_id, menu_id);

-- Proveedores
create table if not exists public.resto_proveedores (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  nombre text not null,
  telefono text,
  correo text,
  nota text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Órdenes de compra (lo que se pide a un proveedor)
create table if not exists public.resto_ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  proveedor text not null,
  estado text not null default 'pendiente',   -- pendiente | recibida | anulada
  items jsonb not null default '[]',          -- [{insumo_id, n, u, q}]
  nota text,
  creada_por text,
  created_at timestamptz not null default now(),
  recibida_at timestamptz
);
create index if not exists resto_oc_local_idx on public.resto_ordenes_compra (local_id, created_at desc);

alter table public.resto_recetas enable row level security;
alter table public.resto_proveedores enable row level security;
alter table public.resto_ordenes_compra enable row level security;

do $$ begin
  create policy p_recetas_sel on public.resto_recetas for select using (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_recetas_mod on public.resto_recetas for all
    using (local_id = resto_mi_local() and public.resto_puede(array['admin']))
    with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_prov_all on public.resto_proveedores for all
    using (local_id = resto_mi_local() and public.resto_puede(array['admin']))
    with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_oc_all on public.resto_ordenes_compra for all
    using (local_id = resto_mi_local() and public.resto_puede(array['admin']))
    with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy soporte_lee_recetas on public.resto_recetas for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;
do $$ begin
  create policy soporte_lee_prov on public.resto_proveedores for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;
do $$ begin
  create policy soporte_lee_oc on public.resto_ordenes_compra for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;

-- Al vender un producto con receta se descuentan sus insumos (cualquier garzón puede vender,
-- por eso es SECURITY DEFINER: valida que el producto sea del local de quien llama).
-- Nunca bloquea la venta: si no alcanza el insumo, el stock queda en 0.
create or replace function public.resto_receta_consumir(p_menu uuid, p_cant numeric, p_por text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_local uuid := resto_mi_local(); r record; v_new numeric; v_prev numeric; v_gasto numeric;
begin
  if v_local is null or p_cant is null or p_cant <= 0 then return; end if;
  if not exists (select 1 from public.resto_menu where id = p_menu and local_id = v_local) then return; end if;
  for r in select insumo_id, cantidad from public.resto_recetas where menu_id = p_menu and local_id = v_local loop
    select stock into v_prev from public.resto_insumos where id = r.insumo_id and local_id = v_local for update;
    if v_prev is null then continue; end if;
    v_gasto := least(v_prev, r.cantidad * p_cant);
    update public.resto_insumos set stock = stock - v_gasto where id = r.insumo_id returning stock into v_new;
    if v_gasto > 0 then
      insert into public.resto_insumo_mov(local_id, insumo_id, delta, motivo, stock_despues, nota, registrado_por)
      values (v_local, r.insumo_id, -v_gasto, 'uso', v_new, 'Venta automática (receta)', p_por);
    end if;
  end loop;
end $$;
grant execute on function public.resto_receta_consumir(uuid, numeric, text) to authenticated;

do $$ begin alter publication supabase_realtime add table public.resto_recetas; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resto_ordenes_compra; exception when others then null; end $$;

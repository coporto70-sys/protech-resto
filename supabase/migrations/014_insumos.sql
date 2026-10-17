-- Protech Resto · inventario de producción (insumos): mermeladas, tarros de duraznos, cremas, harinas, etc.
-- Es aparte de la carta: aquí NO están los productos que se venden, sino lo que se compra para producirlos.
-- Solo AGREGA tablas y una función. No borra ni modifica datos existentes. Es seguro ejecutarlo más de una vez.

create table if not exists public.resto_insumos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  nombre text not null,
  unidad text not null default 'un',          -- un, kg, g, lt, ml, tarro, caja, bolsa, paquete
  stock numeric not null default 0,
  stock_min numeric not null default 0,       -- avisa cuando queda esta cantidad o menos
  costo_unit numeric,                         -- costo por unidad de la última compra
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists resto_insumos_local_idx on public.resto_insumos (local_id, nombre);

-- Cada compra, uso, merma o conteo queda registrado (no se edita ni se borra)
create table if not exists public.resto_insumo_mov (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  insumo_id uuid not null,
  delta numeric not null,                     -- + entra, − sale
  motivo text not null,                       -- compra | uso | merma | conteo
  stock_despues numeric,
  costo_total integer,                        -- lo pagado en la compra
  tipo_doc text,                              -- Boleta | Factura | Sin documento
  numero_doc text,
  proveedor text,
  nota text,
  pagado_caja boolean not null default false, -- se pagó con dinero de la caja (queda también en gastos de caja)
  registrado_por text,
  created_at timestamptz not null default now()
);
create index if not exists resto_insumo_mov_local_idx on public.resto_insumo_mov (local_id, created_at desc);

alter table public.resto_insumos enable row level security;
alter table public.resto_insumo_mov enable row level security;
do $$ begin create policy p_insumos on public.resto_insumos for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_insumo_mov_sel on public.resto_insumo_mov for select using (local_id = resto_mi_local()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_insumo_mov_ins on public.resto_insumo_mov for insert with check (local_id = resto_mi_local()); exception when duplicate_object then null; end $$;
do $$ begin create policy soporte_lee_insumos on public.resto_insumos for select using (public.resto_es_soporte()); exception when duplicate_object or undefined_function then null; end $$;
do $$ begin create policy soporte_lee_insumo_mov on public.resto_insumo_mov for select using (public.resto_es_soporte()); exception when duplicate_object or undefined_function then null; end $$;

-- Movimiento atómico: cambia el stock y deja el registro en una sola operación
create or replace function public.resto_insumo_mover(
  p_insumo uuid, p_delta numeric, p_motivo text, p_por text,
  p_nota text default null, p_costo integer default null, p_tipo text default null,
  p_num text default null, p_prov text default null, p_caja boolean default false)
returns numeric language plpgsql security invoker as $$
declare v_local uuid; v_new numeric;
begin
  select local_id into v_local from public.resto_insumos where id = p_insumo and local_id = resto_mi_local();
  if v_local is null then raise exception 'Insumo no encontrado'; end if;
  update public.resto_insumos
     set stock = stock + p_delta,
         costo_unit = case when p_motivo = 'compra' and p_delta > 0 and p_costo is not null then round(p_costo::numeric / p_delta, 2) else costo_unit end
   where id = p_insumo returning stock into v_new;
  if v_new < 0 then raise exception 'No alcanza el stock'; end if;
  insert into public.resto_insumo_mov(local_id, insumo_id, delta, motivo, stock_despues, costo_total, tipo_doc, numero_doc, proveedor, nota, pagado_caja, registrado_por)
  values (v_local, p_insumo, p_delta, p_motivo, v_new, p_costo, p_tipo, p_num, p_prov, p_nota, coalesce(p_caja, false), p_por);
  return v_new;
end $$;

do $$ begin alter publication supabase_realtime add table public.resto_insumos; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resto_insumo_mov; exception when others then null; end $$;

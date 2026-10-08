-- Protech Resto · migración completa (PIN, caja, inventario, para llevar/delivery, reservas)
-- Solo AGREGA columnas/tablas. No borra ni modifica datos existentes.

-- Etapa 1: PIN
alter table public.resto_locales  add column if not exists admin_pin text;
alter table public.resto_garzones add column if not exists pin text;

-- Etapa 2: caja (turnos)
create table if not exists public.resto_turnos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  abierto_por text,
  abierto_at timestamptz not null default now(),
  monto_inicial integer not null default 0,
  cerrado_at timestamptz,
  cerrado_por text,
  esperado_efectivo integer,
  contado_efectivo integer,
  diferencia integer,
  ventas_total integer,
  ventas_efectivo integer,
  ventas_tarjeta integer,
  ventas_transf integer,
  propinas integer,
  cuentas integer,
  nota text
);
alter table public.resto_cuentas add column if not exists turno_id uuid;
alter table public.resto_cuentas add column if not exists cobrado_por text;

-- Etapa 4: para llevar y delivery (usan números de pedido desde 1001)
create table if not exists public.resto_pedidos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  num integer not null,
  tipo text not null default 'llevar',
  cliente text,
  telefono text,
  direccion text,
  cerrado boolean not null default false,
  created_at timestamptz not null default now()
);

-- Etapa 3: inventario
alter table public.resto_menu add column if not exists stock integer;
alter table public.resto_menu add column if not exists stock_min integer not null default 0;
create table if not exists public.resto_stock_mov (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  menu_id uuid,
  delta integer not null,
  motivo text,
  por text,
  created_at timestamptz not null default now()
);

-- Etapa 5: reservas
create table if not exists public.resto_reservas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  fecha date not null,
  hora text not null,
  personas integer not null default 2,
  nombre text not null,
  telefono text,
  mesa integer,
  nota text,
  estado text not null default 'pendiente',
  created_at timestamptz not null default now()
);

-- Seguridad: cada local solo ve lo suyo (mismo patrón que las demás tablas)
alter table public.resto_turnos    enable row level security;
alter table public.resto_pedidos   enable row level security;
alter table public.resto_stock_mov enable row level security;
alter table public.resto_reservas  enable row level security;
do $$ begin
  create policy p_turnos  on public.resto_turnos    for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_pedidos on public.resto_pedidos   for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_smov    on public.resto_stock_mov for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_resv    on public.resto_reservas  for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;

-- Descuento de stock atómico (evita errores si dos garzones piden a la vez)
create or replace function public.resto_stock_mover(p_menu uuid, p_delta integer, p_motivo text, p_por text, p_log boolean default false)
returns void language plpgsql security invoker as $$
begin
  update public.resto_menu set stock = stock + p_delta
   where id = p_menu and local_id = resto_mi_local() and stock is not null;
  if p_log then
    insert into public.resto_stock_mov(local_id, menu_id, delta, motivo, por)
    values (resto_mi_local(), p_menu, p_delta, p_motivo, p_por);
  end if;
end $$;

-- Actualización en vivo
do $$ begin alter publication supabase_realtime add table public.resto_turnos;   exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resto_pedidos;  exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resto_reservas; exception when others then null; end $$;

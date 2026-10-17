-- Protech Resto · sencillo fijo de caja, retiro de efectivo de ventas y gastos pagados desde caja
-- Solo AGREGA columnas y una tabla. No borra ni modifica datos existentes. Es seguro ejecutarlo más de una vez.

-- 1) Sencillo fijo que siempre debe quedar en la caja (para dar vueltos)
alter table public.resto_locales add column if not exists fondo_caja integer not null default 0;

-- 2) Al cerrar: cuánto efectivo de ventas se retiró, qué billetes y monedas quedaron en caja y el total de gastos del turno
alter table public.resto_turnos add column if not exists retiro_efectivo integer;
alter table public.resto_turnos add column if not exists desglose_deja jsonb;
alter table public.resto_turnos add column if not exists gastos_total integer;

-- 3) Gastos que salen de la caja (con número de boleta o factura). Solo se agregan y se leen: no se editan ni se borran.
create table if not exists public.resto_gastos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  turno_id uuid,
  tipo text not null default 'Boleta',        -- Boleta | Factura | Sin documento
  numero text,                                -- número de la boleta o factura
  proveedor text,                             -- a quién se le pagó
  detalle text not null,                      -- qué se compró o pagó
  monto integer not null check (monto > 0),   -- dinero que salió de la caja
  registrado_por text,
  created_at timestamptz not null default now()
);
create index if not exists resto_gastos_local_idx on public.resto_gastos (local_id, created_at desc);
alter table public.resto_gastos enable row level security;
do $$ begin
  create policy p_gastos_sel on public.resto_gastos for select using (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_gastos_ins on public.resto_gastos for insert with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
-- Soporte de Protech puede revisarlos (solo lectura)
do $$ begin
  create policy soporte_lee_resto_gastos on public.resto_gastos for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;

do $$ begin alter publication supabase_realtime add table public.resto_gastos; exception when others then null; end $$;

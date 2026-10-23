-- Protech Resto · 030 · Ventas de tortas (encargos con abonos y calendario de entregas)
-- El cliente encarga una torta, deja abonos y al retirarla paga el saldo. Se guardan sus datos (nombre, teléfono) y la fecha de entrega.
-- Los abonos entran a la caja del turno en que se reciben; el saldo se cobra al retirar como una venta normal.
-- Solo AGREGA tablas. No modifica nada existente. Es seguro ejecutarlo más de una vez.

create table if not exists public.resto_tortas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  cliente text not null,
  telefono text,
  descripcion text not null,                  -- sabor, tamaño, dedicatoria…
  precio integer not null check (precio > 0), -- precio total de la torta
  entrega_at timestamptz not null,            -- fecha y hora de entrega
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'retirada', 'cancelada')),
  creado_por text,
  editado_por text,
  retirado_at timestamptz,
  retirado_por text,
  cuenta_id uuid,                             -- cobro del saldo al retirar (resto_cuentas)
  created_at timestamptz not null default now()
);
create index if not exists resto_tortas_local_idx on public.resto_tortas (local_id, entrega_at);

create table if not exists public.resto_tortas_abonos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  torta_id uuid not null,
  monto integer not null check (monto > 0),
  metodo text not null check (metodo in ('Efectivo', 'Tarjeta', 'Transferencia')),
  turno_id uuid,
  recibido_por text,
  anulado boolean not null default false,
  anulado_por text,
  anulado_motivo text,
  created_at timestamptz not null default now()
);
create index if not exists resto_tortas_abonos_idx on public.resto_tortas_abonos (local_id, created_at desc);

alter table public.resto_tortas enable row level security;
alter table public.resto_tortas_abonos enable row level security;

do $$ begin create policy p_tortas_sel on public.resto_tortas for select using (local_id = resto_mi_local()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_tortas_ins on public.resto_tortas for insert with check (local_id = resto_mi_local() and public.resto_puede_caja()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_tortas_upd on public.resto_tortas for update using (local_id = resto_mi_local() and public.resto_puede_caja()) with check (local_id = resto_mi_local() and public.resto_puede_caja()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_tabonos_sel on public.resto_tortas_abonos for select using (local_id = resto_mi_local()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_tabonos_ins on public.resto_tortas_abonos for insert with check (local_id = resto_mi_local() and public.resto_puede_caja()); exception when duplicate_object then null; end $$;
do $$ begin create policy p_tabonos_upd on public.resto_tortas_abonos for update using (local_id = resto_mi_local() and public.resto_puede_caja()) with check (local_id = resto_mi_local() and public.resto_puede_caja()); exception when duplicate_object then null; end $$;

-- Soporte de Protech puede revisarlos (solo lectura)
do $$ begin create policy soporte_lee_resto_tortas on public.resto_tortas for select using (public.resto_es_soporte()); exception when duplicate_object or undefined_function then null; end $$;
do $$ begin create policy soporte_lee_resto_tortas_abonos on public.resto_tortas_abonos for select using (public.resto_es_soporte()); exception when duplicate_object or undefined_function then null; end $$;

do $$ begin alter publication supabase_realtime add table public.resto_tortas; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resto_tortas_abonos; exception when others then null; end $$;

insert into public.resto_migraciones (nombre) values ('030_tortas') on conflict do nothing;

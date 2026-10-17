-- Protech Resto · anulación de productos ya enviados (el garzón solicita, la administradora autoriza)
-- Solo AGREGA una tabla. No borra ni modifica datos existentes.
-- Es seguro ejecutarlo más de una vez.

create table if not exists public.resto_anulaciones (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  comanda_id uuid not null,
  item_n text not null,                       -- nombre del producto dentro de la comanda
  cantidad integer not null default 1,
  precio integer not null default 0,
  mesa integer not null,
  garzon text,                                -- garzón que atiende la mesa
  estacion text,                              -- 'cocina' o 'cafeteria'
  estado_comanda text,                        -- estado de la comanda al pedir la anulación
  motivo text,
  estado text not null default 'pendiente',   -- pendiente | aprobada | rechazada
  pedida_por text,
  resuelta_por text,
  resuelta_at timestamptz,
  perdida boolean not null default false,     -- cocina ya lo había preparado: no vuelve al stock
  created_at timestamptz not null default now()
);

-- Seguridad: cada local solo ve lo suyo (mismo patrón que las demás tablas)
alter table public.resto_anulaciones enable row level security;
do $$ begin
  create policy p_anulaciones on public.resto_anulaciones for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;

-- Actualización en vivo (la administradora y la cocina se enteran al instante)
do $$ begin alter publication supabase_realtime add table public.resto_anulaciones; exception when others then null; end $$;

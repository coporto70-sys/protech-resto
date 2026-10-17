-- Protech Resto · cocineras con PIN (ingreso al dispositivo de cocina)
-- Solo AGREGA una tabla. No borra ni modifica datos existentes.
-- Es seguro ejecutarlo más de una vez.

create table if not exists public.resto_cocineras (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  nombre text not null,
  activo boolean not null default true,
  pin text,
  created_at timestamptz not null default now()
);

-- Seguridad: cada local solo ve lo suyo (mismo patrón que las demás tablas)
alter table public.resto_cocineras enable row level security;
do $$ begin
  create policy p_cocineras on public.resto_cocineras for all using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;

-- Actualización en vivo
do $$ begin alter publication supabase_realtime add table public.resto_cocineras; exception when others then null; end $$;

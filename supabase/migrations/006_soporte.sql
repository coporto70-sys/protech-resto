-- Protech Resto · portal de soporte + chat en vivo
-- Solo AGREGA políticas y una tabla nueva. No borra ni modifica datos existentes.

-- 1) ¿El usuario es soporte de Protech? (rol protech_admin en su cuenta)
create or replace function public.resto_es_soporte() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'protech_admin'
$$;

-- 2) Soporte puede LEER (solo lectura) los datos de todos los locales para revisarlos.
--    No se toca resto_miembros: así la app sigue cargando el local propio sin confusiones.
do $$
declare t text;
begin
  foreach t in array array['resto_locales','resto_menu','resto_comandas','resto_cuentas','resto_garzones',
                           'resto_cocineras','resto_turnos','resto_pedidos','resto_reservas','resto_sesiones','resto_stock_mov']
  loop
    begin
      execute format('create policy %I on public.%I for select using (public.resto_es_soporte())', 'soporte_lee_' || t, t);
    exception when duplicate_object or undefined_table then null;
    end;
  end loop;
end $$;

-- 3) Chat en vivo entre cada local y soporte (con el asistente automático en medio)
create table if not exists public.resto_chat (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  autor text not null check (autor in ('cliente', 'bot', 'soporte')),
  quien text,
  texto text not null,
  humano boolean not null default false,        -- el cliente pidió hablar con una persona
  visto_soporte boolean not null default false, -- soporte ya leyó este mensaje
  created_at timestamptz not null default now()
);
create index if not exists resto_chat_local_idx on public.resto_chat (local_id, created_at desc);
alter table public.resto_chat enable row level security;

-- Cada local ve y escribe solo en su propio chat (como cliente o asistente; nunca como soporte)
do $$ begin
  create policy p_chat_local_sel on public.resto_chat for select using (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_chat_local_ins on public.resto_chat for insert
    with check (local_id = resto_mi_local() and autor in ('cliente', 'bot'));
exception when duplicate_object then null; end $$;

-- Soporte ve todos los chats, responde y marca como leídos
do $$ begin
  create policy p_chat_soporte on public.resto_chat for all
    using (public.resto_es_soporte()) with check (public.resto_es_soporte());
exception when duplicate_object then null; end $$;

-- Mensajes en vivo
do $$ begin alter publication supabase_realtime add table public.resto_chat; exception when others then null; end $$;

-- Protech Resto · 029 · Agente de operaciones por WhatsApp
-- Un agente con IA (Claude) que conversa por WhatsApp con el equipo (ingeniero y administradoras), consulta datos reales del local
-- con herramientas de SOLO LECTURA, vigila el sistema cada 10 minutos y avisa cada apertura y cierre de caja.
-- No abre ni cierra caja, no anula, no corrige y no mueve dinero.
-- Usa la misma función Edge `resto-whatsapp` (carpeta supabase/functions/resto-whatsapp), el mismo número de WhatsApp de la 024
-- y el secreto ANTHROPIC_API_KEY. Depende de la 022 (resto_push_config, pg_net), la 024 y la 026.
-- Solo AGREGA tablas, columnas, funciones y disparadores. Es seguro ejecutarlo más de una vez.

-- Plantilla aprobada por Meta para escribirle primero a alguien (pasadas 24 h desde su último mensaje).
-- Se crea en WhatsApp Manager con una sola variable {{1}}. Ver docs/AGENTE.md.
alter table public.resto_wa_config add column if not exists plantilla_aviso text;

-- Quién puede hablar con el agente de operaciones. El rol 'ingeniero' ve todos los locales; 'admin' solo el suyo.
-- Para que el agente reconozca a la persona, su número debe estar aquí (solo dígitos con código de país: 569XXXXXXXX).
create table if not exists public.resto_wa_equipo (
  id uuid primary key default gen_random_uuid(),
  local_id uuid,                                  -- obligatorio para 'admin'; vacío para 'ingeniero' (todos los locales)
  telefono text not null unique check (telefono ~ '^[0-9]{8,15}$'),
  nombre text not null,
  rol text not null check (rol in ('ingeniero', 'admin')),
  avisos text not null default 'importantes' check (avisos in ('todo', 'importantes', 'nada')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  check (rol = 'ingeniero' or local_id is not null)
);
alter table public.resto_wa_equipo enable row level security;

-- Conversación del equipo con el agente (aparte de los chats de clientes)
create table if not exists public.resto_agente_msgs (
  id bigserial primary key,
  equipo_id uuid references public.resto_wa_equipo(id) on delete set null,
  telefono text not null,
  autor text not null check (autor in ('equipo', 'agente')),
  texto text not null,
  wa_id text unique,                              -- evita responder dos veces si Meta reenvía el mismo mensaje
  created_at timestamptz not null default now()
);
create index if not exists resto_agente_msgs_tel on public.resto_agente_msgs (telefono, created_at desc);
alter table public.resto_agente_msgs enable row level security;

-- Avisos ya emitidos por el vigía y por las aperturas/cierres. La clave única evita repetir el mismo aviso.
create table if not exists public.resto_agente_avisos (
  id bigserial primary key,
  local_id uuid not null,
  clave text not null,
  gravedad text not null check (gravedad in ('alta', 'media', 'baja')),
  titulo text not null,
  detalle text not null default '',
  enviados_wa integer not null default 0,
  created_at timestamptz not null default now(),
  unique (local_id, clave)
);
create index if not exists resto_agente_avisos_local on public.resto_agente_avisos (local_id, created_at desc);
alter table public.resto_agente_avisos enable row level security;

-- Lista de propuestas de mejora que el agente guarda cuando alguien sugiere un cambio. No cambian nada solas: decide el ingeniero.
create table if not exists public.resto_agente_propuestas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid,
  titulo text not null,
  detalle text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  propuesta_por text,
  created_at timestamptz not null default now(),
  resuelta_at timestamptz
);
alter table public.resto_agente_propuestas enable row level security;

-- Ninguna de estas tablas tiene políticas: nadie las lee ni escribe desde la app; solo la función Edge (clave de servicio).
-- Soporte de Protech puede revisarlas.
do $$ begin
  create policy soporte_lee_agente_avisos on public.resto_agente_avisos for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;
do $$ begin
  create policy soporte_lee_agente_propuestas on public.resto_agente_propuestas for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;

-- Dirección de la función (la clave interna 'secreto' ya existe desde la 022)
insert into public.resto_push_config (clave, valor) values
  ('url_agente', 'https://fchqqtdapyrgpkyxiful.supabase.co/functions/v1/resto-whatsapp')
  on conflict (clave) do nothing;

-- Llama al agente con la clave interna. La entrega es asíncrona: nunca demora ni rompe la apertura o el cierre de caja.
create or replace function public.resto_agente_pedir(p_cuerpo jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_sec text;
begin
  select valor into v_url from public.resto_push_config where clave = 'url_agente';
  select valor into v_sec from public.resto_push_config where clave = 'secreto';
  if v_url is null or v_sec is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
    body := p_cuerpo);
exception when others then null;
end $$;
revoke all on function public.resto_agente_pedir(jsonb) from public, anon, authenticated;

-- Avisa cada apertura y cada cierre de caja (solo en locales con el control de caja activado, igual que la 026)
create or replace function public.resto_agente_turno_disparar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_on boolean;
begin
  select control_caja into v_on from public.resto_locales where id = new.local_id;
  if not coalesce(v_on, false) then return null; end if;
  if TG_OP = 'INSERT' then
    perform public.resto_agente_pedir(jsonb_build_object('accion', 'evento_turno', 'fase', 'apertura', 'turno_id', new.id));
  elsif old.cerrado_at is null and new.cerrado_at is not null then
    perform public.resto_agente_pedir(jsonb_build_object('accion', 'evento_turno', 'fase', 'cierre', 'turno_id', new.id));
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_agente_turno_ins on public.resto_turnos;
create trigger resto_agente_turno_ins after insert on public.resto_turnos
  for each row execute function public.resto_agente_turno_disparar();
drop trigger if exists resto_agente_turno_upd on public.resto_turnos;
create trigger resto_agente_turno_upd after update on public.resto_turnos
  for each row execute function public.resto_agente_turno_disparar();

-- Vigía cada 10 minutos y limpieza diaria de conversaciones y avisos con más de 90 días.
-- Requiere la extensión pg_cron (Supabase → Database → Extensions). Si no está activa, el resto de la migración igual queda aplicada
-- y el vigía se puede programar después ejecutando de nuevo solo este bloque.
do $$
begin
  begin create extension if not exists pg_cron; exception when others then null; end;
  begin perform cron.unschedule(jobid) from cron.job where jobname in ('resto-vigia', 'resto-agente-limpieza'); exception when others then null; end;
  perform cron.schedule('resto-vigia', '*/10 * * * *', $q$select public.resto_agente_pedir(jsonb_build_object('accion', 'vigia'))$q$);
  perform cron.schedule('resto-agente-limpieza', '0 7 * * *', $q$
    delete from public.resto_agente_msgs where created_at < now() - interval '90 days';
    delete from public.resto_agente_avisos where created_at < now() - interval '90 days'
  $q$);
exception when others then
  raise notice 'pg_cron no está disponible: activa la extensión y vuelve a ejecutar este bloque para programar el vigía (%).', sqlerrm;
end $$;

insert into public.resto_migraciones (nombre) values ('029_agente_operaciones') on conflict do nothing;

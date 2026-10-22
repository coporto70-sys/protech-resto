-- Protech Resto · 026 · Control de caja: revisa cada apertura y cada cierre y avisa a los administradores de posibles errores de ingreso
-- Cuando se abre o se cierra un turno, la base llama a la función Edge `resto-control-caja` (supabase/functions/resto-control-caja).
-- La función aplica reglas fijas (tarjetas que no cuadran, apertura sin sencillo, retiro repetido, etc.), guarda las alertas
-- y manda un aviso push a los administradores. Solo LEE y AVISA: nunca corrige, anula ni mueve dinero.
-- Requiere publicar la función Edge `resto-control-caja` con la verificación de JWT DESACTIVADA (la llama la base con una clave interna).
-- Opcional: el secreto ANTHROPIC_API_KEY (ya usado por resto-whatsapp) para que redacte un resumen en lenguaje simple.
-- Depende de la 022 (resto_push_config y resto_push_enviar). Solo AGREGA tablas, una función y un disparador. Es seguro ejecutarlo más de una vez.

-- Solo se revisan los locales que tienen el control activado (por defecto, ninguno). Así no se manda ningún aviso a otros clientes sin que lo pidan.
-- Para activarlo en un local:  update public.resto_locales set control_caja = true where nombre ilike '%super pastel%';
alter table public.resto_locales add column if not exists control_caja boolean not null default false;

-- Una fila por turno y fase revisados (evita avisar dos veces la misma apertura o el mismo cierre)
create table if not exists public.resto_control_revisiones (
  turno_id uuid not null,
  fase text not null default 'cierre' check (fase in ('apertura', 'cierre')),
  primary key (turno_id, fase),
  local_id uuid not null,
  revisado_at timestamptz not null default now(),
  n_alertas integer not null default 0,
  aviso text                                  -- resumen en lenguaje simple (si hay clave de IA)
);
create index if not exists resto_control_rev_local on public.resto_control_revisiones (local_id, revisado_at desc);

-- Las alertas detectadas en cada turno
create table if not exists public.resto_control_alertas (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  turno_id uuid not null,
  fase text not null default 'cierre' check (fase in ('apertura', 'cierre')),
  regla text not null,
  gravedad text not null check (gravedad in ('alta', 'media', 'baja')),
  titulo text not null,
  detalle text not null,
  revisar text not null,
  created_at timestamptz not null default now(),
  visto_por text,
  visto_at timestamptz,
  unique (turno_id, regla, detalle)
);
create index if not exists resto_control_alertas_local on public.resto_control_alertas (local_id, created_at desc);

alter table public.resto_control_revisiones enable row level security;
alter table public.resto_control_alertas enable row level security;

-- La administradora las lee; escribir solo lo hace la función Edge (clave de servicio). Soporte de Protech puede revisarlas.
do $$ begin
  create policy p_ctrl_rev_sel on public.resto_control_revisiones for select
    using (local_id = resto_mi_local() and public.resto_puede(array['admin']));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy p_ctrl_alt_sel on public.resto_control_alertas for select
    using (local_id = resto_mi_local() and public.resto_puede(array['admin']));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy soporte_lee_ctrl_rev on public.resto_control_revisiones for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;
do $$ begin
  create policy soporte_lee_ctrl_alt on public.resto_control_alertas for select using (public.resto_es_soporte());
exception when duplicate_object or undefined_function then null; end $$;
-- La administradora puede marcar una alerta como vista (solo esos dos campos, por la política de abajo y el control del disparador)
do $$ begin
  create policy p_ctrl_alt_upd on public.resto_control_alertas for update
    using (local_id = resto_mi_local() and public.resto_puede(array['admin']))
    with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));
exception when duplicate_object then null; end $$;

create or replace function public.resto_control_alertas_inmutable() returns trigger
language plpgsql as $$
begin
  if auth.role() = 'service_role' then return new; end if;
  if (to_jsonb(new) - 'visto_por' - 'visto_at') is distinct from (to_jsonb(old) - 'visto_por' - 'visto_at') then
    raise exception 'Una alerta solo se puede marcar como vista';
  end if;
  return new;
end $$;
drop trigger if exists resto_control_alertas_inmutable on public.resto_control_alertas;
create trigger resto_control_alertas_inmutable before update on public.resto_control_alertas
  for each row execute function public.resto_control_alertas_inmutable();

-- Dirección de la función (la clave interna 'secreto' ya existe desde la 022)
insert into public.resto_push_config (clave, valor) values
  ('url_control', 'https://fchqqtdapyrgpkyxiful.supabase.co/functions/v1/resto-control-caja')
  on conflict (clave) do nothing;

-- Al abrirse o cerrarse un turno, pide la revisión. La entrega es asíncrona: nunca demora ni rompe la apertura o el cierre de caja.
create or replace function public.resto_control_caja_pedir(p_accion text, p_turno uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_sec text;
begin
  select valor into v_url from public.resto_push_config where clave = 'url_control';
  select valor into v_sec from public.resto_push_config where clave = 'secreto';
  if v_url is null or v_sec is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
    body := jsonb_build_object('accion', p_accion, 'turno_id', p_turno));
exception when others then null;
end $$;

create or replace function public.resto_control_caja_disparar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_on boolean;
begin
  select control_caja into v_on from public.resto_locales where id = new.local_id;
  if not coalesce(v_on, false) then return null; end if;
  if TG_OP = 'INSERT' then
    perform public.resto_control_caja_pedir('revisar_apertura', new.id);
  elsif old.cerrado_at is null and new.cerrado_at is not null then
    perform public.resto_control_caja_pedir('revisar', new.id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_control_caja_disparar on public.resto_turnos;
create trigger resto_control_caja_disparar after update on public.resto_turnos
  for each row execute function public.resto_control_caja_disparar();
drop trigger if exists resto_control_caja_disparar_ins on public.resto_turnos;
create trigger resto_control_caja_disparar_ins after insert on public.resto_turnos
  for each row execute function public.resto_control_caja_disparar();

insert into public.resto_migraciones (nombre) values ('026_control_caja') on conflict do nothing;

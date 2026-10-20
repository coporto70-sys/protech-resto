-- Protech Resto · 022 · Avisos push a la administradora (llegan al celular aunque Resto esté cerrado)
-- Avisa cuando: alguien pide anular un producto, alguien pide anular un gasto, o se da un descuento/cortesía.
-- Requiere publicar además la función Edge `resto-push` (carpeta supabase/functions/resto-push), SIN verificación de JWT.
-- Solo AGREGA tablas, funciones y disparadores. Es seguro ejecutarlo más de una vez.

do $$ begin create extension if not exists pg_net; exception when others then null; end $$;

-- Dispositivos de la administradora que activaron los avisos
create table if not exists public.resto_push_subs (
  id uuid primary key default gen_random_uuid(),
  local_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  quien text,
  created_at timestamptz not null default now()
);
create index if not exists resto_push_subs_local on public.resto_push_subs (local_id);
alter table public.resto_push_subs enable row level security;
drop policy if exists p_push_subs on public.resto_push_subs;
create policy p_push_subs on public.resto_push_subs for all
  using (local_id = resto_mi_local() and public.resto_puede(array['admin']))
  with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));

-- Configuración interna (claves de envío y dirección de la función). Sin políticas: nadie la lee desde la app.
create table if not exists public.resto_push_config (clave text primary key, valor text not null);
alter table public.resto_push_config enable row level security;
insert into public.resto_push_config (clave, valor) values
  ('url', 'https://fchqqtdapyrgpkyxiful.supabase.co/functions/v1/resto-push'),
  ('secreto', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (clave) do nothing;

create or replace function public.resto_mesa_txt(m integer) returns text language sql immutable as $$
  select case when m = 0 then 'Venta mostrador' when m >= 1000 then 'Pedido #' || (m - 1000)
              when m > 100 then 'Piso 2 · Mesa ' || (m - 100) else 'Mesa ' || m end
$$;
create or replace function public.resto_pesos(n numeric) returns text language sql immutable as $$
  select '$' || replace(to_char(coalesce(n, 0), 'FM999,999,999,999'), ',', '.')
$$;

-- Manda el aviso (la entrega es asíncrona: nunca demora ni rompe lo que está haciendo el garzón)
create or replace function public.resto_push_enviar(p_local uuid, p_titulo text, p_cuerpo text, p_tag text) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_sec text;
begin
  select valor into v_url from public.resto_push_config where clave = 'url';
  select valor into v_sec from public.resto_push_config where clave = 'secreto';
  if v_url is null or v_sec is null then return; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_sec),
    body := jsonb_build_object('accion', 'enviar', 'local_id', p_local, 'titulo', p_titulo, 'cuerpo', p_cuerpo, 'tag', p_tag));
exception when others then null;
end $$;

-- 1) Solicitud de anulación de un producto
create or replace function public.resto_push_anulacion() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'pendiente' then
    perform public.resto_push_enviar(new.local_id, 'Solicitud de anulación',
      coalesce(new.pedida_por, new.garzon, 'Un garzón') || ' pide anular ' || new.cantidad || '× ' || new.item_n || ' · ' || public.resto_mesa_txt(new.mesa) || coalesce(' · ' || nullif(new.motivo, ''), ''),
      'anu-' || new.id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_push_anulacion on public.resto_anulaciones;
create trigger resto_push_anulacion after insert on public.resto_anulaciones
  for each row execute function public.resto_push_anulacion();

-- 2) Solicitud de anulación de un gasto de caja
create or replace function public.resto_push_gasto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.anul_pedida_motivo is null and new.anul_pedida_motivo is not null and not new.anulado then
    perform public.resto_push_enviar(new.local_id, 'Solicitud de anulación de gasto',
      coalesce(new.anul_pedida_por, 'Caja') || ' pide anular ' || new.tipo || coalesce(' N° ' || new.numero, '') || ' por ' || public.resto_pesos(new.monto) || ' · ' || new.anul_pedida_motivo,
      'gas-' || new.id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_push_gasto on public.resto_gastos;
create trigger resto_push_gasto after update on public.resto_gastos
  for each row execute function public.resto_push_gasto();

-- 3) Descuento o cortesía dado en un cobro
create or replace function public.resto_push_descuento() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.descuento, 0) > 0 then
    perform public.resto_push_enviar(new.local_id, 'Descuento autorizado',
      public.resto_pesos(new.descuento) || ' de descuento · ' || public.resto_mesa_txt(new.mesa) || coalesce(' · ' || nullif(new.desc_motivo, ''), '') || coalesce(' · autorizó ' || nullif(new.desc_aut, ''), ''),
      'des-' || new.id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists resto_push_descuento on public.resto_cuentas;
create trigger resto_push_descuento after insert on public.resto_cuentas
  for each row execute function public.resto_push_descuento();

insert into public.resto_migraciones (nombre) values ('022_push') on conflict do nothing;

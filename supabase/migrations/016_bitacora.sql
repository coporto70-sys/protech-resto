-- Protech Resto · 016 · Registro de cambios (quién cambió qué y cuándo)
-- Guarda automáticamente los cambios en carta, garzones, cocineras, local, inventario de producción, caja y gastos.
-- Solo la administradora puede leerlo. Nadie puede editarlo ni borrarlo desde la app.

create table if not exists public.resto_bitacora (
  id bigint generated always as identity primary key,
  local_id uuid not null,
  at timestamptz not null default now(),
  quien text,
  rol text,
  tabla text not null,
  accion text not null,
  fila text,
  detalle jsonb
);
create index if not exists resto_bitacora_local_at on public.resto_bitacora (local_id, at desc);
alter table public.resto_bitacora enable row level security;
drop policy if exists p_bit_sel on public.resto_bitacora;
create policy p_bit_sel on public.resto_bitacora for select
  using (local_id = resto_mi_local() and public.resto_puede(array['admin']));
do $$ begin alter publication supabase_realtime add table public.resto_bitacora; exception when others then null; end $$;

create or replace function public.resto_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_o jsonb; v_n jsonb; v_det jsonb; v_fila text; k text;
  v_excl text[] := array['stock', 'pin', 'admin_pin', 'created_at', 'updated_at', 'items', 'desglose_apertura', 'desglose_cierre', 'desglose_deja', 'pago_propinas', 'id', 'local_id'];
begin
  if TG_OP = 'DELETE' then v_o := to_jsonb(OLD); v_n := null; else v_n := to_jsonb(NEW); v_o := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end; end if;
  if TG_TABLE_NAME = 'resto_locales' then v_local := coalesce((v_n ->> 'id')::uuid, (v_o ->> 'id')::uuid);
  else v_local := coalesce((v_n ->> 'local_id')::uuid, (v_o ->> 'local_id')::uuid); end if;
  v_fila := coalesce(v_n ->> 'nombre', v_o ->> 'nombre', v_n ->> 'detalle', v_o ->> 'detalle', v_n ->> 'id', v_o ->> 'id');

  if TG_OP = 'UPDATE' then
    select jsonb_object_agg(key, jsonb_build_object('antes', v_o -> key, 'despues', value)) into v_det
      from jsonb_each(v_n) where (v_o -> key) is distinct from value and key <> all (v_excl);
    if (v_o ->> 'pin') is distinct from (v_n ->> 'pin') or (v_o ->> 'admin_pin') is distinct from (v_n ->> 'admin_pin') then
      v_det := coalesce(v_det, '{}'::jsonb) || jsonb_build_object('pin', jsonb_build_object('antes', null, 'despues', 'cambiado'));
    end if;
    if v_det is null then return null; end if;
  else
    v_det := (coalesce(v_n, v_o)) - v_excl;
  end if;
  insert into public.resto_bitacora (local_id, quien, rol, tabla, accion, fila, detalle)
    values (v_local, coalesce(public.resto_quien_actual(), 'sin identificar'), public.resto_rol_actual(), TG_TABLE_NAME, TG_OP, v_fila, v_det);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['resto_menu', 'resto_garzones', 'resto_cocineras', 'resto_locales', 'resto_insumos', 'resto_turnos', 'resto_gastos'] loop
    execute format('create or replace trigger resto_audit_%s after insert or update or delete on public.%I for each row execute function public.resto_audit()', t, t);
  end loop;
end $$;

insert into public.resto_migraciones (nombre) values ('016_bitacora') on conflict do nothing;

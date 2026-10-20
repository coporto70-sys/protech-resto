-- Protech Resto · 021 · La administradora puede corregir la forma de pago de un cobro del turno abierto
-- Caso típico: el garzón registró el cobro como Tarjeta y en realidad fue Efectivo (o al revés).
-- Solo cambia la forma de pago (y quita la propina extra con tarjeta si ya no fue tarjeta). Montos, mesa, ítems y fecha no se pueden tocar.
-- Queda el método original, quién corrigió y el motivo, y el cambio aparece en el Registro de cambios.
-- Solo AGREGA columnas, una política y triggers. Es seguro ejecutarlo más de una vez.

alter table public.resto_cuentas add column if not exists metodo_original text;
alter table public.resto_cuentas add column if not exists metodo_editado_por text;
alter table public.resto_cuentas add column if not exists metodo_editado_motivo text;
alter table public.resto_cuentas add column if not exists metodo_editado_at timestamptz;

-- Solo la administradora (o soporte) puede actualizar un cobro de su local
drop policy if exists p_cue_upd on public.resto_cuentas;
create policy p_cue_upd on public.resto_cuentas for update
  using (local_id = resto_mi_local() and public.resto_puede(array['admin']))
  with check (local_id = resto_mi_local() and public.resto_puede(array['admin']));

create or replace function public.resto_cuentas_metodo() returns trigger
language plpgsql as $$
begin
  -- Todo lo demás del cobro es inmutable
  if (to_jsonb(new) - 'metodo' - 'propina_tarj' - 'metodo_original' - 'metodo_editado_por' - 'metodo_editado_motivo' - 'metodo_editado_at')
     is distinct from
     (to_jsonb(old) - 'metodo' - 'propina_tarj' - 'metodo_original' - 'metodo_editado_por' - 'metodo_editado_motivo' - 'metodo_editado_at') then
    raise exception 'Un cobro registrado no se puede modificar, solo corregir su forma de pago';
  end if;
  if new.metodo is not distinct from old.metodo and new.propina_tarj is not distinct from old.propina_tarj then
    return new;
  end if;
  if new.metodo not in ('Efectivo', 'Tarjeta', 'Transferencia') then
    raise exception 'Forma de pago no válida';
  end if;
  if new.metodo is not distinct from old.metodo then
    raise exception 'Un cobro registrado no se puede modificar, solo corregir su forma de pago';
  end if;
  if not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede corregir la forma de pago';
  end if;
  if not exists (select 1 from public.resto_turnos t where t.id = old.turno_id and t.cerrado_at is null) then
    raise exception 'Solo se puede corregir un cobro de un turno abierto';
  end if;
  if coalesce(btrim(new.metodo_editado_motivo), '') = '' then
    raise exception 'Escribe el motivo de la corrección';
  end if;
  -- La propina extra con tarjeta solo existe si se pagó con tarjeta; si pasa a efectivo o transferencia, se quita
  if new.metodo <> 'Tarjeta' then new.propina_tarj := 0; end if;
  new.metodo_original := coalesce(old.metodo_original, old.metodo);
  new.metodo_editado_at := now();
  return new;
end $$;
drop trigger if exists resto_cuentas_metodo on public.resto_cuentas;
create trigger resto_cuentas_metodo before update on public.resto_cuentas
  for each row execute function public.resto_cuentas_metodo();

-- Registro de cambios: ahora también guarda las correcciones de cobros (solo las modificaciones, no cada venta)
create or replace function public.resto_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid; v_o jsonb; v_n jsonb; v_det jsonb; v_fila text; k text;
  v_excl text[] := array['stock', 'pin', 'admin_pin', 'created_at', 'updated_at', 'items', 'desglose_apertura', 'desglose_cierre', 'desglose_deja', 'pago_propinas', 'id', 'local_id'];
begin
  if TG_OP = 'DELETE' then v_o := to_jsonb(OLD); v_n := null; else v_n := to_jsonb(NEW); v_o := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end; end if;
  if TG_TABLE_NAME = 'resto_locales' then v_local := coalesce((v_n ->> 'id')::uuid, (v_o ->> 'id')::uuid);
  else v_local := coalesce((v_n ->> 'local_id')::uuid, (v_o ->> 'local_id')::uuid); end if;
  v_fila := coalesce(v_n ->> 'nombre', v_o ->> 'nombre', v_n ->> 'detalle', v_o ->> 'detalle',
                     case when TG_TABLE_NAME = 'resto_cuentas' then case when coalesce(v_n ->> 'mesa', v_o ->> 'mesa') = '0' then 'Mostrador' else 'Mesa ' || coalesce(v_n ->> 'mesa', v_o ->> 'mesa') end end,
                     v_n ->> 'id', v_o ->> 'id');

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
create or replace trigger resto_audit_resto_cuentas after update on public.resto_cuentas
  for each row execute function public.resto_audit();

insert into public.resto_migraciones (nombre) values ('021_cuentas_metodo') on conflict do nothing;

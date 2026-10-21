-- Protech Resto · 025 · Cerrar la caja con fecha de corte (por ejemplo, cerrar solo el día de ayer)
-- Caso típico: nadie cerró la caja anoche y hoy ya hay ventas. La administradora cierra el turno "hasta el día 20/10":
--   · el turno abierto se cierra con fecha de cierre = el corte (lo cobrado, gastos y retiros hasta ese momento),
--   · se abre un turno nuevo que parte en el corte con el sencillo que se dejó en caja,
--   · los cobros, gastos y retiros posteriores al corte pasan al turno nuevo (se conservan, no se pierden ni se borran).
-- Solo la administradora (o soporte) puede hacerlo. Es una sola operación: o se hace completa o no se hace nada.
-- Solo AGREGA una función y reemplaza dos funciones de control (para permitir el traslado solo dentro de esta operación).
-- Es seguro ejecutarlo más de una vez.

-- 1) Los gastos siguen siendo inmutables, salvo el traslado de turno que hace la función de más abajo
create or replace function public.resto_gastos_inmutable() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('resto.dividir', true), '') = 'on' then
    -- Traslado al turno nuevo hecho por resto_cerrar_turno_corte: solo puede cambiar el turno
    if (to_jsonb(new) - 'turno_id') is distinct from (to_jsonb(old) - 'turno_id') then
      raise exception 'Un gasto registrado no se puede modificar, solo anular';
    end if;
    return new;
  end if;
  -- Estos datos nunca cambian
  if new.local_id is distinct from old.local_id or new.turno_id is distinct from old.turno_id
     or new.registrado_por is distinct from old.registrado_por
     or new.created_at is distinct from old.created_at
     or new.monto_original is distinct from old.monto_original and old.monto_original is not null then
    raise exception 'Un gasto registrado no se puede modificar, solo anular';
  end if;
  -- Corregir el monto: solo la administradora, en un turno abierto, en un gasto vigente y con motivo
  if new.tipo is distinct from old.tipo or new.numero is distinct from old.numero
     or new.proveedor is distinct from old.proveedor or new.detalle is distinct from old.detalle
     or new.monto is distinct from old.monto then
    if new.tipo is distinct from old.tipo or new.numero is distinct from old.numero
       or new.proveedor is distinct from old.proveedor or new.detalle is distinct from old.detalle then
      raise exception 'Un gasto registrado no se puede modificar, solo corregir su monto o anular';
    end if;
    if not public.resto_puede(array['admin']) then
      raise exception 'Solo la administradora puede corregir un gasto';
    end if;
    if old.anulado then
      raise exception 'Un gasto anulado no se puede corregir';
    end if;
    if not exists (select 1 from public.resto_turnos t where t.id = old.turno_id and t.cerrado_at is null) then
      raise exception 'Solo se puede corregir un gasto de un turno abierto';
    end if;
    if coalesce(btrim(new.editado_motivo), '') = '' then
      raise exception 'Escribe el motivo de la corrección';
    end if;
    new.monto_original := coalesce(old.monto_original, old.monto);
    new.editado_at := now();
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un gasto anulado no se puede reactivar';
  end if;
  if new.anulado and not old.anulado and not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede autorizar la anulación de un gasto';
  end if;
  return new;
end $$;

-- 2) Los cobros siguen siendo inmutables, salvo el traslado de turno que hace la función de más abajo
create or replace function public.resto_cuentas_metodo() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('resto.dividir', true), '') = 'on' then
    -- Traslado al turno nuevo hecho por resto_cerrar_turno_corte: solo puede cambiar el turno
    if (to_jsonb(new) - 'turno_id') is distinct from (to_jsonb(old) - 'turno_id') then
      raise exception 'Un cobro registrado no se puede modificar, solo corregir su forma de pago';
    end if;
    return new;
  end if;
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

-- 3) Cerrar el turno abierto hasta una fecha de corte y abrir uno nuevo con lo posterior
-- p_cierre trae lo mismo que el cierre normal: cerrado_por, nota, esperado_efectivo, contado_efectivo, diferencia, ventas_total, ventas_efectivo,
-- ventas_tarjeta, ventas_transf, propinas, cuentas, desglose_cierre, desglose_deja, retiro_efectivo, gastos_total, propinas_pagadas, pago_propinas,
-- y monto_nuevo (sencillo que queda en caja = sencillo inicial del turno nuevo).
create or replace function public.resto_cerrar_turno_corte(p_turno uuid, p_corte timestamptz, p_cierre jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_t public.resto_turnos%rowtype;
  v_nuevo uuid;
begin
  if not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede cerrar la caja con fecha de corte';
  end if;
  select * into v_t from public.resto_turnos
    where id = p_turno and local_id = public.resto_mi_local() and cerrado_at is null for update;
  if not found then
    raise exception 'No hay un turno abierto con ese identificador';
  end if;
  if p_corte <= v_t.abierto_at or p_corte > now() then
    raise exception 'La fecha de corte debe estar entre la apertura del turno y este momento';
  end if;

  -- Turno nuevo: parte en el corte con el sencillo que se dejó en la caja
  insert into public.resto_turnos (local_id, abierto_por, abierto_at, monto_inicial, desglose_apertura)
    values (v_t.local_id, p_cierre ->> 'cerrado_por', p_corte, coalesce((p_cierre ->> 'monto_nuevo')::integer, 0), p_cierre -> 'desglose_deja')
    returning id into v_nuevo;

  -- Los cobros, gastos, retiros y entradas posteriores al corte pasan al turno nuevo
  perform set_config('resto.dividir', 'on', true);
  update public.resto_gastos   set turno_id = v_nuevo where turno_id = v_t.id and created_at > p_corte;
  update public.resto_cuentas  set turno_id = v_nuevo where turno_id = v_t.id and created_at > p_corte;
  update public.resto_sesiones set turno_id = v_nuevo where turno_id = v_t.id and entrada > p_corte;
  perform set_config('resto.dividir', 'off', true);
  -- Quienes estaban en caja antes del corte salen a esa hora (al volver a entrar quedan en el turno nuevo)
  update public.resto_sesiones set salida = p_corte where turno_id = v_t.id and salida is null;

  -- Cierre del turno viejo, con el cuadre calculado solo hasta el corte
  update public.resto_turnos set
    cerrado_at = p_corte,
    cerrado_por = p_cierre ->> 'cerrado_por',
    esperado_efectivo = (p_cierre ->> 'esperado_efectivo')::integer,
    contado_efectivo = (p_cierre ->> 'contado_efectivo')::integer,
    diferencia = (p_cierre ->> 'diferencia')::integer,
    ventas_total = (p_cierre ->> 'ventas_total')::integer,
    ventas_efectivo = (p_cierre ->> 'ventas_efectivo')::integer,
    ventas_tarjeta = (p_cierre ->> 'ventas_tarjeta')::integer,
    ventas_transf = (p_cierre ->> 'ventas_transf')::integer,
    propinas = (p_cierre ->> 'propinas')::integer,
    cuentas = (p_cierre ->> 'cuentas')::integer,
    nota = nullif(p_cierre ->> 'nota', ''),
    desglose_cierre = p_cierre -> 'desglose_cierre',
    desglose_deja = p_cierre -> 'desglose_deja',
    retiro_efectivo = (p_cierre ->> 'retiro_efectivo')::integer,
    gastos_total = (p_cierre ->> 'gastos_total')::integer,
    propinas_pagadas = (p_cierre ->> 'propinas_pagadas')::integer,
    pago_propinas = p_cierre -> 'pago_propinas'
  where id = v_t.id;

  return v_nuevo;
end $$;
grant execute on function public.resto_cerrar_turno_corte(uuid, timestamptz, jsonb) to authenticated;

insert into public.resto_migraciones (nombre) values ('025_cierre_con_corte') on conflict do nothing;

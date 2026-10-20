-- Protech Resto · 020 · La administradora puede corregir el monto de un gasto de caja del turno abierto
-- Antes un gasto solo se podía anular. Ahora la administradora (o soporte) puede corregir el monto, con motivo obligatorio.
-- El monto original queda guardado y el cambio (antes → después, quién y cuándo) aparece en el Registro de cambios.
-- Solo AGREGA columnas y reemplaza la función de control. Es seguro ejecutarlo más de una vez.

alter table public.resto_gastos add column if not exists monto_original integer;
alter table public.resto_gastos add column if not exists editado_por text;
alter table public.resto_gastos add column if not exists editado_at timestamptz;
alter table public.resto_gastos add column if not exists editado_motivo text;

create or replace function public.resto_gastos_inmutable() returns trigger
language plpgsql as $$
begin
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

insert into public.resto_migraciones (nombre) values ('020_gastos_editar') on conflict do nothing;

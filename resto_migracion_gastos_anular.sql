-- Protech Resto · anulación de gastos de caja (la solicita quien está en caja, la autoriza la administradora)
-- Solo AGREGA columnas, un trigger y una política. No borra ni modifica datos existentes. Es seguro ejecutarlo más de una vez.

alter table public.resto_gastos add column if not exists anulado boolean not null default false;
alter table public.resto_gastos add column if not exists anulado_por text;
alter table public.resto_gastos add column if not exists anulado_at timestamptz;
alter table public.resto_gastos add column if not exists anulado_motivo text;
alter table public.resto_gastos add column if not exists anul_pedida_por text;
alter table public.resto_gastos add column if not exists anul_pedida_motivo text;

-- Un gasto nunca se borra ni se edita: lo único que puede cambiar es marcarlo como anulado (queda el registro) o dejar la solicitud.
create or replace function public.resto_gastos_inmutable() returns trigger
language plpgsql as $$
begin
  if new.local_id is distinct from old.local_id or new.turno_id is distinct from old.turno_id
     or new.tipo is distinct from old.tipo or new.numero is distinct from old.numero
     or new.proveedor is distinct from old.proveedor or new.detalle is distinct from old.detalle
     or new.monto is distinct from old.monto or new.registrado_por is distinct from old.registrado_por
     or new.created_at is distinct from old.created_at then
    raise exception 'Un gasto registrado no se puede modificar, solo anular';
  end if;
  if old.anulado and not new.anulado then
    raise exception 'Un gasto anulado no se puede reactivar';
  end if;
  return new;
end $$;
drop trigger if exists resto_gastos_inmutable on public.resto_gastos;
create trigger resto_gastos_inmutable before update on public.resto_gastos
  for each row execute function public.resto_gastos_inmutable();

do $$ begin
  create policy p_gastos_upd on public.resto_gastos for update
    using (local_id = resto_mi_local()) with check (local_id = resto_mi_local());
exception when duplicate_object then null; end $$;

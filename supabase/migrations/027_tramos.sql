-- Protech Resto · 027 · Tramos: Resto se activa por etapas, de lo más fácil a lo más avanzado
-- Cada local tiene un "tramo" del 1 al 4. La administradora solo ve las pestañas de su tramo y de los anteriores;
-- las demás aparecen con candado. Solo Protech (soporte o el acceso de Carlos Oporto, Ingeniero) puede cambiar el tramo.
--   1 · Salir a vender:      Mesas, Cocina, Cafetería, Carta y mesas, Garzones
--   2 · Cuadrar el día:      Caja, Ventas, Resumen, Comandas
--   3 · Control del local:   Inventario, Reservas, Registro de cambios
--   4 · Producción y costos: Inventario de producción, Compras y recetas
-- El valor por defecto es 4 (todo abierto): los locales que ya existen NO cambian hasta que Protech les asigne un tramo.
-- Solo AGREGA una columna y un disparador. No borra ni modifica datos. Es seguro ejecutarlo más de una vez.

alter table public.resto_locales add column if not exists tramo smallint not null default 4;
do $$ begin
  alter table public.resto_locales add constraint resto_locales_tramo_chk check (tramo between 1 and 4);
exception when duplicate_object then null; end $$;

-- Ni la administradora ni el personal pueden cambiar el tramo, aunque llamen a la base directamente
create or replace function public.resto_tramo_control() returns trigger
language plpgsql as $$
begin
  if new.tramo is distinct from old.tramo then
    if not (
      coalesce(public.resto_es_soporte(), false)
      or coalesce(public.resto_rol_actual() = 'ingeniero', false)
      or coalesce(auth.role(), '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin')      -- editor SQL de Supabase
    ) then
      raise exception 'Solo Protech puede cambiar el tramo del local';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists resto_tramo_control on public.resto_locales;
create trigger resto_tramo_control before update on public.resto_locales
  for each row execute function public.resto_tramo_control();

-- Para dejar a Super Pastel en el tramo 2 (ejecútalo tú cuando quieras activarlo):
--   update public.resto_locales set tramo = 2 where nombre ilike '%super pastel%';

insert into public.resto_migraciones (nombre) values ('027_tramos') on conflict do nothing;

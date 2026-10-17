-- Protech Resto · garzones autorizados para cobrar en caja
-- Solo AGREGA una columna. No borra datos.
-- Los garzones que ya tienen PIN quedan autorizados para no cortar la operación;
-- la administradora puede quitar o dar el permiso después en "Carta y mesas".
-- Es seguro ejecutarlo más de una vez: el permiso inicial se da solo la primera vez.

do $$ begin if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resto_garzones' and column_name = 'caja') then alter table public.resto_garzones add column caja boolean not null default false; update public.resto_garzones set caja = true where pin is not null; end if; end $$;

-- Protech Resto · código de barras en productos
-- Solo AGREGA una columna y un índice. No borra ni modifica datos existentes.
-- Ejecutar una vez en Supabase (proyecto micaja-pos) > SQL Editor.

alter table public.resto_menu add column if not exists codigo text;

-- Un código de barras no se repite dentro del mismo local (los vacíos no cuentan)
create unique index if not exists resto_menu_local_codigo_uq
  on public.resto_menu (local_id, codigo)
  where codigo is not null and codigo <> '';

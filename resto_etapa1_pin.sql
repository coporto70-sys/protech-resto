-- Protech Resto · Etapa 1: accesos por usuario con PIN
-- Ejecutar una vez en Supabase > SQL Editor. No borra ni cambia datos existentes.
alter table public.resto_locales  add column if not exists admin_pin text;
alter table public.resto_garzones add column if not exists pin text;

-- Protech Resto · 028 · El sencillo de la caja ya no es fijo
-- La caja funciona en dos turnos (mañana y tarde) y la administradora no deja siempre el mismo sencillo.
-- Desde ahora cada turno debe recibir lo que dejó el anterior. Para el primer turno se usa un "sencillo de partida"
-- (resto_locales.fondo_caja) y resto_locales.fondo_desde marca desde cuándo se usa esta regla: los cierres anteriores a esa fecha se ignoran.
-- Solo AGREGA una columna y ajusta el local Super Pastel. No borra ni modifica turnos. Es seguro ejecutarlo más de una vez.

alter table public.resto_locales add column if not exists fondo_desde timestamptz;

-- Super Pastel: desde hoy 22/10/2026 a las 9:00 (hora de Chile) todo parte de cero con $168.570 de sencillo
update public.resto_locales
   set fondo_caja = 168570,
       fondo_desde = timestamptz '2026-10-22 09:00:00-03'
 where nombre ilike '%super pastel%';

insert into public.resto_migraciones (nombre) values ('028_sencillo_variable') on conflict do nothing;

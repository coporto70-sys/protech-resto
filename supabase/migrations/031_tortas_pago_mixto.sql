-- Protech Resto · 031 · Pago mixto en los abonos de tortas
-- Permite que un abono se pague parte en efectivo y parte con tarjeta (metodo = 'Mixto', pago_efec = la parte en efectivo).
-- Es seguro ejecutarlo más de una vez. No modifica abonos existentes.

alter table public.resto_tortas_abonos add column if not exists pago_efec integer;
alter table public.resto_tortas_abonos drop constraint if exists resto_tortas_abonos_metodo_check;
alter table public.resto_tortas_abonos add constraint resto_tortas_abonos_metodo_check check (metodo in ('Efectivo', 'Tarjeta', 'Transferencia', 'Mixto'));

insert into public.resto_migraciones (nombre) values ('031_tortas_pago_mixto') on conflict do nothing;

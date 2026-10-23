-- Protech Resto · 029 · Pago mixto (efectivo + tarjeta)
-- Un cliente puede pagar una parte en efectivo y el resto con tarjeta. La cuenta se guarda con metodo = 'Mixto' y
-- pago_efec = lo que se pagó en efectivo (de total + propina). La parte con tarjeta es el resto (más la propina extra con tarjeta, propina_tarj).
-- Solo AGREGA una columna. No modifica cobros existentes. Es seguro ejecutarlo más de una vez.

alter table public.resto_cuentas add column if not exists pago_efec integer;

insert into public.resto_migraciones (nombre) values ('029_pago_mixto') on conflict do nothing;

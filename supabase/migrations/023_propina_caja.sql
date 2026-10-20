-- Protech Resto · 023 · Propina en efectivo: ¿quedó en la caja (del vuelto) o se la dieron directo al garzón?
-- Una propina en efectivo que queda en la caja se suma al efectivo esperado y se le paga al garzón al cerrar la caja,
-- así el cuadre no tiene diferencias. La que se dio directo en la mano no entra a la caja ni se paga de nuevo.
-- Los cobros anteriores quedan como estaban (directo en mano). Solo AGREGA una columna. Seguro de ejecutar más de una vez.

alter table public.resto_cuentas add column if not exists propina_efec_caja boolean not null default false;

insert into public.resto_migraciones (nombre) values ('023_propina_caja') on conflict do nothing;

-- Protech Resto · propinas de los garzones pagadas en efectivo desde la caja al cerrar el turno
-- Solo AGREGA dos columnas. No borra ni modifica datos existentes. Es seguro ejecutarlo más de una vez.
alter table public.resto_turnos add column if not exists propinas_pagadas integer;
alter table public.resto_turnos add column if not exists pago_propinas jsonb;   -- [{n: garzón, m: monto pagado, c: cuentas}]

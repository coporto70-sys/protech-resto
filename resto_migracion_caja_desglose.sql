-- Protech Resto · caja con conteo de billetes y monedas
-- Solo AGREGA dos columnas. No borra ni modifica datos existentes.
alter table public.resto_turnos add column if not exists desglose_apertura jsonb;
alter table public.resto_turnos add column if not exists desglose_cierre jsonb;

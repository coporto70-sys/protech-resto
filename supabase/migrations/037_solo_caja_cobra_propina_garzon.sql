-- 037 · Solo la caja registra pagos; el garzón solo indica la propina de la mesa
-- (pendiente de aplicar en el proyecto micaja-pos; es idempotente)
-- 1) Desde ahora ningún local deja cobrar a los garzones sin PIN de caja: el trigger de resto_cuentas (025/035/036)
--    ya rechaza el cobro de un garzón cuando garzon_cobra = false y no está en caja.
alter table public.resto_locales alter column garzon_cobra set default false;
update public.resto_locales set garzon_cobra = false where garzon_cobra is distinct from false;

-- 2) Propina que el garzón indica al pedir la cuenta: { inc, pct, tj, efe, donde, por }. La caja la precarga al cobrar.
alter table public.resto_comandas add column if not exists propina_pedida jsonb;

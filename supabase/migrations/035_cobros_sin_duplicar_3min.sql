-- 035 · Cobros sin duplicados: ventana de 3 minutos
-- (ya aplicada en el proyecto micaja-pos el 27/10/2026; es idempotente)
-- La regla de 5 segundos de la 025 dejaba pasar los cobros repetidos hechos entre 9 s y 1 min después.
-- Regla nueva: en mesas, el mismo cobro (mesa, monto, productos, forma de pago, garzón, parte) dentro de 3 minutos
-- se rechaza, salvo que haya entrado una comanda nueva a esa mesa después del primer cobro.

create or replace function public.resto_cuentas_sin_duplicar()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.local_id::text || ':' || new.mesa::text, 0));

  if coalesce(public.resto_rol_actual(), '') = 'garzon'
     and not coalesce((select l.garzon_cobra from public.resto_locales l where l.id = new.local_id), true)
     and not public.resto_caja_actual() then
    raise exception 'En este local solo cobra la caja: avisa a la caja para cobrar esta cuenta';
  end if;

  -- Regla 1: mismo cobro exacto en los últimos 5 segundos
  if exists (
    select 1 from public.resto_cuentas c
    where c.local_id = new.local_id
      and c.id <> new.id
      and c.mesa = new.mesa
      and c.total = new.total
      and c.items = new.items
      and c.garzon is not distinct from new.garzon
      and c.parte is not distinct from new.parte
      and c.created_at > now() - interval '5 seconds'
  ) then
    raise exception 'Este cobro ya se registró hace unos segundos. Revisa la mesa antes de cobrar de nuevo';
  end if;

  -- Regla 2: en mesas, mismo cobro dentro de 3 minutos y sin comanda nueva en esa mesa después del primer cobro
  if new.mesa > 0 and exists (
    select 1 from public.resto_cuentas c
    where c.local_id = new.local_id
      and c.id <> new.id
      and c.mesa = new.mesa
      and c.total = new.total
      and c.items = new.items
      and c.metodo = new.metodo
      and c.garzon is not distinct from new.garzon
      and c.parte is not distinct from new.parte
      and c.created_at > now() - interval '3 minutes'
      and not exists (
        select 1 from public.resto_comandas m
        where m.local_id = c.local_id
          and m.mesa = c.mesa
          and m.created_at > c.created_at
      )
  ) then
    raise exception 'Esta mesa ya se cobró con el mismo monto hace instantes. Revisa la mesa antes de cobrar de nuevo';
  end if;

  return new;
end $function$;

revoke execute on function public.resto_cuentas_sin_duplicar() from public, anon, authenticated;

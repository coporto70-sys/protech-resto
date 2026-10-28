-- 036 · Cobro repetido: solo se bloquea si lo cobrado supera lo pedido
-- La regla 2 de la 035 bloqueaba cobros legitimos (dos cortados pedidos en comandas distintas y cobrados por separado).
-- Ahora el mismo cobro dentro de 3 minutos se rechaza SOLO si, para algun producto, lo cobrado en la mesa (ultimas 12 h)
-- pasaria de lo pedido en comandas de esa mesa (ultimas 12 h).
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

  -- Regla 2: mismo cobro en 3 minutos Y se cobraria mas de lo pedido
  if new.mesa > 0 and exists (
    select 1 from public.resto_cuentas c
    where c.local_id = new.local_id and c.id <> new.id and c.mesa = new.mesa
      and c.total = new.total and c.items = new.items and c.metodo = new.metodo
      and c.garzon is not distinct from new.garzon and c.parte is not distinct from new.parte
      and c.created_at > now() - interval '3 minutes'
  ) and exists (
    select 1 from jsonb_array_elements(new.items) i
    where coalesce((select sum((x->>'q')::numeric) from public.resto_comandas m, jsonb_array_elements(m.items) x
                    where m.local_id = new.local_id and m.mesa = new.mesa and m.created_at > now() - interval '12 hours' and x->>'n' = i->>'n'), 0)
        < coalesce((select sum((x->>'q')::numeric) from public.resto_cuentas c2, jsonb_array_elements(c2.items) x
                    where c2.local_id = new.local_id and c2.mesa = new.mesa and c2.id <> new.id and c2.created_at > now() - interval '12 hours' and x->>'n' = i->>'n'), 0)
          + coalesce((i->>'q')::numeric, 0)
  ) then
    raise exception 'Esta mesa ya se cobró con el mismo monto hace instantes y no queda más pedido por cobrar. Revisa la mesa antes de cobrar de nuevo';
  end if;

  return new;
end $function$;

revoke execute on function public.resto_cuentas_sin_duplicar() from public, anon, authenticated;

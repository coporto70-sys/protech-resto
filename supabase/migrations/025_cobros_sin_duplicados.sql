-- 025 · Cobros sin duplicados, "garzón puede cobrar" por local y "Pedir cuenta"
-- (ya aplicada en el proyecto micaja-pos el 25/10/2026; es idempotente)

-- 1) Ajuste por local: ¿los garzones cobran sus mesas? (true = como funciona hoy)
alter table public.resto_locales add column if not exists garzon_cobra boolean not null default true;

-- 2) Cuenta pedida por el garzón (la mesa queda "por cobrar" para la caja)
alter table public.resto_comandas add column if not exists cuenta_pedida_at timestamptz;

-- 3) Validación en el servidor al registrar un cobro
create or replace function public.resto_cuentas_sin_duplicar()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  -- Serializa cobros simultáneos de la misma mesa (doble toque / dos dispositivos a la vez)
  perform pg_advisory_xact_lock(hashtextextended(new.local_id::text || ':' || new.mesa::text, 0));

  -- Si el local dejó "garzón cobra" en NO, solo cobra la caja (admin o garzón autorizado con PIN de caja)
  if coalesce(public.resto_rol_actual(), '') = 'garzon'
     and not coalesce((select l.garzon_cobra from public.resto_locales l where l.id = new.local_id), true)
     and not public.resto_caja_actual() then
    raise exception 'En este local solo cobra la caja: avisa a la caja para cobrar esta cuenta';
  end if;

  -- Cobro idéntico (mesa, total, productos, garzón) hace menos de 5 s = doble toque.
  -- El reintento del mismo id (cola sin conexión) no cuenta como repetido.
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

  return new;
end $$;

revoke execute on function public.resto_cuentas_sin_duplicar() from public, anon, authenticated;

drop trigger if exists resto_cuentas_dup on public.resto_cuentas;
create trigger resto_cuentas_dup
  before insert on public.resto_cuentas
  for each row execute function public.resto_cuentas_sin_duplicar();

-- 4) Aviso push a la administradora cuando un garzón pide la cuenta (una sola vez por mesa)
create or replace function public.resto_push_cuenta_pedida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.cuenta_pedida_at is not null and old.cuenta_pedida_at is null and not new.cerrada then
    if not exists (
      select 1 from public.resto_comandas c
      where c.local_id = new.local_id and c.mesa = new.mesa and not c.cerrada
        and c.cuenta_pedida_at = new.cuenta_pedida_at and c.id < new.id
    ) then
      perform public.resto_push_enviar(new.local_id, '🧾 Cuenta pedida',
        coalesce(nullif(new.garzon, ''), 'Un garzón') || ' pide la cuenta · ' || public.resto_mesa_txt(new.mesa),
        'cuenta-' || new.mesa);
    end if;
  end if;
  return null;
exception when others then return null;
end $$;

revoke execute on function public.resto_push_cuenta_pedida() from public, anon, authenticated;

drop trigger if exists resto_push_cuenta_pedida on public.resto_comandas;
create trigger resto_push_cuenta_pedida
  after update of cuenta_pedida_at on public.resto_comandas
  for each row execute function public.resto_push_cuenta_pedida();

-- Protech Resto · 019 · Los garzones pueden quitar o cambiar la propina sin autorización de la administradora.
-- Solo reemplaza una función. Los descuentos y cortesías siguen necesitando a la administradora. Seguro de ejecutar más de una vez.

create or replace function public.resto_cuentas_autorizadas() returns trigger language plpgsql as $$
begin
  if coalesce(new.descuento, 0) > 0 and not public.resto_puede(array['admin']) then
    raise exception 'Un descuento necesita la autorización de la administradora';
  end if;
  return new;
end $$;

insert into public.resto_migraciones (nombre) values ('019_propina_libre') on conflict do nothing;

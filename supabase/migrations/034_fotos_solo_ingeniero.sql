-- Protech Resto · 034 · Las fotos de la carta solo las puede agregar, cambiar o quitar el ingeniero de Protech
--
-- Las fotos son un servicio de Protech: la administradora del local las VE en su carta y en el pedido por QR,
-- pero solo quien entra con la tarjeta "Carlos Oporto – Ingeniero de Software" puede ponerlas.
--
-- Se controla en la base de datos (no basta con esconder el botón): cualquier cambio de resto_menu.foto hecho desde la app
-- por alguien que no sea el ingeniero se rechaza. Las llamadas al almacenamiento no llevan el pase de sesión, por eso el control
-- está en la columna: un archivo subido por otra persona queda suelto y nunca se muestra, porque no se puede enlazar a un plato.
-- Los cambios hechos desde el panel de Supabase o con la clave de servicio (sin sesión de usuario) siguen permitidos.
-- Es idempotente: se puede ejecutar más de una vez.

create or replace function public.resto_foto_solo_ingeniero() returns trigger
language plpgsql security definer set search_path = public as $$
declare rol_jwt text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if rol_jwt in ('authenticated', 'anon')
     and (case when tg_op = 'INSERT' then new.foto is not null else new.foto is distinct from old.foto end)
     and coalesce(public.resto_rol_actual(), '') <> 'ingeniero' then
    raise exception 'Solo el ingeniero de software de Protech puede agregar, cambiar o quitar fotos de la carta';
  end if;
  return new;
end $$;

drop trigger if exists resto_foto_solo_ingeniero on public.resto_menu;
create trigger resto_foto_solo_ingeniero before insert or update on public.resto_menu
  for each row execute function public.resto_foto_solo_ingeniero();

insert into public.resto_migraciones (nombre) values ('034_fotos_solo_ingeniero') on conflict do nothing;

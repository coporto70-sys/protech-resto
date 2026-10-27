-- Protech Resto · 033 · Fotos de referencia de los productos (se ven en el pedido por QR)
--
-- Agrega resto_menu.foto (dirección de la imagen), un almacenamiento público "resto-fotos" para guardarlas
-- (la administradora sube la foto desde Carta y mesas; cada local solo escribe en su propia carpeta)
-- y entrega la foto en la carta pública del pedido por QR (resto_qr_menu).
-- Solo AGREGA. Es idempotente: se puede ejecutar más de una vez.

alter table public.resto_menu add column if not exists foto text;

insert into storage.buckets (id, name, public) values ('resto-fotos', 'resto-fotos', true)
  on conflict (id) do nothing;

drop policy if exists resto_fotos_ins on storage.objects;
create policy resto_fotos_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'resto-fotos' and (storage.foldername(name))[1] = public.resto_mi_local()::text and public.resto_puede(array['admin']));
drop policy if exists resto_fotos_upd on storage.objects;
create policy resto_fotos_upd on storage.objects for update to authenticated
  using (bucket_id = 'resto-fotos' and (storage.foldername(name))[1] = public.resto_mi_local()::text and public.resto_puede(array['admin']));
drop policy if exists resto_fotos_del on storage.objects;
create policy resto_fotos_del on storage.objects for delete to authenticated
  using (bucket_id = 'resto-fotos' and (storage.foldername(name))[1] = public.resto_mi_local()::text and public.resto_puede(array['admin']));

-- La carta pública ahora incluye la foto ('f') de cada producto
create or replace function public.resto_qr_menu(p_local uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select id, nombre, mesas, coalesce(mesas2, 0) as mesas2, qr_activo, qr_confirmar into l from public.resto_locales where id = p_local;
  if not found then return jsonb_build_object('error', 'no_existe'); end if;
  if not l.qr_activo then return jsonb_build_object('error', 'qr_inactivo', 'nombre', l.nombre); end if;
  return jsonb_build_object(
    'nombre', l.nombre, 'mesas', l.mesas, 'mesas2', l.mesas2, 'confirmar', coalesce(l.qr_confirmar, false),
    'menu', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'n', m.nombre, 'c', m.categoria, 'p', m.precio, 'f', coalesce(m.foto, ''),
               'e', case when m.estacion = 'cafeteria' then 'cafeteria' else 'cocina' end) order by m.categoria, m.nombre)
        from public.resto_menu m
       where m.local_id = p_local and m.activo and (m.stock is null or m.stock > 0)
    ), '[]'::jsonb));
end $$;
revoke all on function public.resto_qr_menu(uuid) from public;
grant execute on function public.resto_qr_menu(uuid) to anon, authenticated;

insert into public.resto_migraciones (nombre) values ('033_fotos_carta') on conflict do nothing;

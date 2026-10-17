-- Protech Resto · 017 · Operación: productos agotados, modificadores, descuentos, propina configurable
-- Solo AGREGA columnas y reglas. Es seguro ejecutarlo más de una vez.

-- Carta: producto agotado (lo puede marcar cualquiera: cocina, garzón, administradora) y opciones/modificadores
alter table public.resto_menu add column if not exists agotado boolean not null default false;
alter table public.resto_menu add column if not exists opciones text;

-- Local: porcentaje de propina sugerida
alter table public.resto_locales add column if not exists propina_pct integer not null default 10;

-- Cuentas: descuentos y cortesías con su motivo y quién los autorizó; parte (cuando la cuenta se divide)
alter table public.resto_cuentas add column if not exists descuento integer not null default 0;
alter table public.resto_cuentas add column if not exists desc_motivo text;
alter table public.resto_cuentas add column if not exists desc_aut text;
alter table public.resto_cuentas add column if not exists parte text;

-- Agotado puede cambiarlo cualquier rol; el resto de la carta (nombre, precio, estación, opciones…) solo la administradora
create or replace function public.resto_menu_proteger() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - 'stock' - 'agotado') is distinct from (to_jsonb(old) - 'stock' - 'agotado') and not public.resto_puede(array['admin']) then
    raise exception 'Solo la administradora puede cambiar la carta (nombre, precio, estación u opciones)';
  end if;
  return new;
end $$;

-- Descuentos, cortesías y cambios de propina necesitan a la administradora (ella misma o con su PIN en el equipo, que da un pase temporal)
create or replace function public.resto_cuentas_autorizadas() returns trigger language plpgsql as $$
declare v_pct integer;
begin
  select coalesce(propina_pct, 10) into v_pct from public.resto_locales where id = new.local_id;
  if (coalesce(new.descuento, 0) > 0
      or (new.mesa > 0 and coalesce(new.propina, 0) <> round(coalesce(new.total, 0) * coalesce(v_pct, 10) / 100.0)))
     and not public.resto_puede(array['admin']) then
    raise exception 'Un descuento o un cambio en la propina necesita la autorización de la administradora';
  end if;
  return new;
end $$;
create or replace trigger resto_cuentas_autorizadas before insert on public.resto_cuentas
  for each row execute function public.resto_cuentas_autorizadas();

-- El pase temporal para autorizar dura 10 minutos (antes 3)
create or replace function public.resto_login(p_rol text, p_ref text, p_pin text default '', p_temp boolean default false) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_local uuid := public.resto_mi_local();
  c public.resto_credenciales%rowtype;
  it public.resto_pin_intentos%rowtype;
  v_key text := coalesce(p_rol, '') || ':' || coalesce(p_ref, '');
  v_quien text; v_caja boolean := false; v_ok boolean := false; v_tok text; v_dur interval; v_scope text;
begin
  if auth.uid() is null or v_local is null then return json_build_object('ok', false, 'error', 'sin_local'); end if;
  if p_rol not in ('admin', 'garzon', 'cocina') then return json_build_object('ok', false, 'error', 'rol'); end if;
  if p_rol = 'admin' then v_quien := 'Administradora'; v_scope := 'admin';
  elsif p_rol = 'garzon' then
    select nombre, coalesce(caja, true) into v_quien, v_caja from public.resto_garzones where id::text = p_ref and local_id = v_local and coalesce(activo, true);
    v_scope := 'g:' || coalesce(p_ref, '');
  else
    select nombre into v_quien from public.resto_cocineras where id::text = p_ref and local_id = v_local and coalesce(activo, true);
    v_scope := 'c:' || coalesce(p_ref, '');
  end if;
  if v_quien is null then return json_build_object('ok', false, 'error', 'no_existe'); end if;
  select * into it from public.resto_pin_intentos where local_id = v_local and clave = v_key for update;
  if found and it.bloqueado_hasta is not null and it.bloqueado_hasta > now() then
    return json_build_object('ok', false, 'error', 'bloqueado', 'hasta', it.bloqueado_hasta);
  end if;
  select * into c from public.resto_credenciales where local_id = v_local and rol = p_rol and ref = p_ref for update;
  if not found then
    if p_rol = 'admin' then return json_build_object('ok', false, 'error', 'sin_pin'); end if;
    v_ok := coalesce(p_pin, '') = '';
    v_caja := false;
  else
    if c.hash is not null then
      v_ok := c.hash = crypt(coalesce(p_pin, ''), c.hash);
    elsif c.legacy is not null then
      v_ok := c.legacy = encode(digest(v_local::text || ':' || v_scope || ':' || coalesce(p_pin, ''), 'sha256'), 'hex');
      if v_ok then
        update public.resto_credenciales set hash = crypt(p_pin, gen_salt('bf')), legacy = null, actualizado_at = now()
         where local_id = v_local and rol = p_rol and ref = p_ref;
      end if;
    end if;
  end if;
  if not v_ok then
    insert into public.resto_pin_intentos (local_id, clave, fallos) values (v_local, v_key, 1)
    on conflict (local_id, clave) do update set
      fallos = case when public.resto_pin_intentos.fallos >= 4 then 0 else public.resto_pin_intentos.fallos + 1 end,
      bloqueado_hasta = case when public.resto_pin_intentos.fallos >= 4 then now() + interval '10 minutes' else null end;
    return json_build_object('ok', false, 'error', 'pin');
  end if;
  delete from public.resto_pin_intentos where local_id = v_local and clave = v_key;
  if p_rol <> 'garzon' then v_caja := false; end if;
  v_dur := case when p_temp then interval '10 minutes' when p_rol = 'cocina' then interval '30 days' else interval '16 hours' end;
  v_tok := encode(gen_random_bytes(24), 'hex');
  delete from public.resto_rol_sesion where expira < now() - interval '1 day';
  insert into public.resto_rol_sesion (token_hash, local_id, rol, ref, quien, caja, temporal, expira)
    values (encode(digest(v_tok, 'sha256'), 'hex'), v_local, p_rol, p_ref, v_quien, v_caja, p_temp, now() + v_dur);
  return json_build_object('ok', true, 'token', v_tok, 'quien', v_quien, 'rol', p_rol, 'caja', v_caja);
end $$;

insert into public.resto_migraciones (nombre) values ('017_operacion') on conflict do nothing;

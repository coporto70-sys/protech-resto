-- 040 · Reporte semanal de caja (solo lectura)
-- Devuelve en JSON el resumen de una semana de un local: ventas, cierres con diferencias,
-- aperturas que no coinciden con lo que dejó el turno anterior, recuentos después del conteo ciego,
-- gastos, retiros y el riesgo por garzón de la semana.
-- Lo usa la tarea programada que envía el reporte por correo cada lunes.
-- Solo lo puede ejecutar el servicio (service_role / postgres): no queda expuesto a la app.

create or replace function public.resto_reporte_semanal(p_local uuid, p_desde date, p_hasta date)
returns jsonb
language sql
stable
set search_path = public
as $$
with rango as (
  select (p_desde::timestamp at time zone 'America/Santiago') as ini,
         ((p_hasta + 1)::timestamp at time zone 'America/Santiago') as fin
),
t as (
  select tu.*,
         lag(tu.contado_efectivo - coalesce(tu.retiro_efectivo, 0)) over (order by tu.abierto_at) as deja_anterior
  from resto_turnos tu
  where tu.local_id = p_local
    and tu.abierto_at >= (select ini from rango) - interval '2 days'
    and tu.abierto_at < (select fin from rango)
),
tw as (
  select * from t where abierto_at >= (select ini from rango) and cerrado_at is not null
),
cu as (
  select c.* from resto_cuentas c, rango r
  where c.local_id = p_local and c.created_at >= r.ini and c.created_at < r.fin
),
an as (
  select a.* from resto_anulaciones a, rango r
  where a.local_id = p_local and a.created_at >= r.ini and a.created_at < r.fin
),
ga as (
  select g.* from resto_gastos g, rango r
  where g.local_id = p_local and g.created_at >= r.ini and g.created_at < r.fin and not coalesce(g.anulado, false)
    and g.tipo in ('Boleta', 'Factura', 'Sin documento')  -- propinas pagadas y retiros van aparte
)
select jsonb_build_object(
  'local', (select nombre from resto_locales where id = p_local),
  'desde', p_desde, 'hasta', p_hasta,
  'totales', jsonb_build_object(
    'turnos', (select count(*) from tw),
    'ventas', (select coalesce(sum(ventas_total), 0) from tw),
    'efectivo', (select coalesce(sum(ventas_efectivo), 0) from tw),
    'tarjeta', (select coalesce(sum(ventas_tarjeta), 0) from tw),
    'transferencia', (select coalesce(sum(ventas_transf), 0) from tw),
    'cuentas', (select coalesce(sum(cuentas), 0) from tw),
    'propinas_pagadas', (select coalesce(sum(propinas_pagadas), 0) from tw),
    'gastos', (select coalesce(sum(monto), 0) from ga),
    'retiros', (select coalesce(sum(retiro_efectivo), 0) from tw),
    'sobrantes_efectivo', (select coalesce(sum(diferencia), 0) from tw where diferencia > 0),
    'faltantes_efectivo', (select coalesce(sum(diferencia), 0) from tw where diferencia < 0),
    'dif_tarjeta', (select coalesce(sum((desglose_cierre->>'dif_tarjeta')::int), 0) from tw),
    'turnos_con_diferencia', (select count(*) from tw where diferencia <> 0 or coalesce((desglose_cierre->>'dif_tarjeta')::int, 0) <> 0)
  ),
  'turnos', (select coalesce(jsonb_agg(jsonb_build_object(
      'dia', (array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'])[extract(dow from abierto_at at time zone 'America/Santiago')::int + 1] || ' ' || to_char(abierto_at at time zone 'America/Santiago', 'DD/MM'),
      'turno', case when extract(hour from abierto_at at time zone 'America/Santiago') < 14 then 'mañana' else 'tarde' end,
      'abrio', abierto_por, 'cerro', cerrado_por,
      'ventas', ventas_total, 'esperado', esperado_efectivo, 'contado', contado_efectivo,
      'dif_efectivo', diferencia,
      'dif_tarjeta', coalesce((desglose_cierre->>'dif_tarjeta')::int, 0),
      'recontado', coalesce((desglose_cierre->'conteo_ciego'->>'recontado')::boolean, false),
      'primer_conteo', (desglose_cierre->'conteo_ciego'->>'ef')::int,
      'nota', nota
    ) order by abierto_at), '[]'::jsonb) from tw),
  'aperturas_distintas', (select coalesce(jsonb_agg(jsonb_build_object(
      'dia', (array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'])[extract(dow from abierto_at at time zone 'America/Santiago')::int + 1] || ' ' || to_char(abierto_at at time zone 'America/Santiago', 'DD/MM HH24:MI'),
      'abrio', abierto_por, 'recibio', monto_inicial, 'dejo_el_anterior', deja_anterior,
      'diferencia', monto_inicial - deja_anterior
    ) order by abierto_at), '[]'::jsonb)
    from t where abierto_at >= (select ini from rango) and deja_anterior is not null and monto_inicial is distinct from deja_anterior),
  'sin_cerrar_mas_de_16h', (select coalesce(jsonb_agg((array['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'])[extract(dow from abierto_at at time zone 'America/Santiago')::int + 1] || ' ' || to_char(abierto_at at time zone 'America/Santiago', 'DD/MM')), '[]'::jsonb)
    from t where abierto_at >= (select ini from rango) and coalesce(cerrado_at, now()) - abierto_at > interval '16 hours'),
  'gastos_mayores', (select coalesce(jsonb_agg(jsonb_build_object('dia', to_char(created_at at time zone 'America/Santiago', 'DD/MM'), 'monto', monto, 'detalle', detalle, 'tipo', tipo, 'numero', numero, 'por', registrado_por) order by monto desc), '[]'::jsonb)
    from (select * from ga order by monto desc limit 5) g),
  'por_garzon', (select coalesce(jsonb_agg(x order by x->>'garzon'), '[]'::jsonb) from (
      select jsonb_build_object(
        'garzon', g,
        'cobros', coalesce(c.cobros, 0), 'ventas', coalesce(c.ventas, 0),
        'con_descuento', coalesce(c.dsc, 0), 'pago_corregido', coalesce(c.corr, 0), 'efectivo_a_otro', coalesce(c.ef_otro, 0),
        'anulaciones', coalesce(a.n, 0), 'anul_monto', coalesce(a.monto, 0)
      ) x
      from (select initcap(lower(btrim(garzon))) g, count(*) cobros, sum(total) ventas,
                   count(*) filter (where coalesce(descuento, 0) > 0) dsc,
                   count(*) filter (where metodo_original is not null) corr,
                   count(*) filter (where metodo_original = 'Efectivo' and metodo <> 'Efectivo') ef_otro
            from cu where coalesce(garzon, '') <> '' group by 1) c
      full join (select initcap(lower(btrim(garzon))) g, count(*) n,
                        sum(coalesce(cantidad, 1) * coalesce(precio, 0)) monto
                 from an where coalesce(garzon, '') <> '' group by 1) a using (g)
    ) s)
);
$$;

revoke all on function public.resto_reporte_semanal(uuid, date, date) from public, anon, authenticated;

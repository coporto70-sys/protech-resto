/* =====================================================
   PROTECH RESTO — Portal de soporte + guía de ayuda de Robi
   - Portal (solo cuentas protech_admin): revisar cualquier local en modo lectura y responder el chat.
   - Ayuda (locales): Robi, el robot de la app, responde con la guía del sistema (KB de abajo); si no sabe, manda a Protech por WhatsApp. El chat en vivo del local fue retirado; la bandeja de soporte conserva el historial.
   Usa las variables globales de index.html (sb, S, D, esc, money, render, toast, sonarListo...).
   ===================================================== */
const WA_SOPORTE = 'https://wa.me/56939473588';
const fdt = x => { if (!x) return '—'; try { return new Date(x).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };
const fdia = x => { try { return new Date(x).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }); } catch (e) { return '—'; } };
const hace = x => { const m = Math.max(0, Math.round((Date.now() - new Date(x).getTime()) / 60000)); return m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : Math.floor(m / 1440) + ' d'; };
const nmesa = m => m === 0 ? 'Mostrador' : m >= 1000 ? 'Pedido #' + (m - 1000) : m > 100 ? 'Piso 2 · Mesa ' + (m - 100) : 'Mesa ' + m;

/* =====================================================
   PORTAL DE SOPORTE
   ===================================================== */
const SP = { sub: 'locales', lid: null, tab: 'resumen', d: null, load: false, err: '', chat: { msgs: [], sel: null, cargado: false, err: '' }, ch: null, dias: 7 };

function adminHTML() {
  const pend = spPendientes();
  const tabs = [['locales', 'Locales y usuarios'], ['revisar', 'Revisar un local'], ['chat', 'Chat soporte' + (pend ? ' 🔴' + pend : '')]];
  return `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">${tabs.map(([k, n]) => `<button class="${SP.sub === k ? 'btn' : 'btn-line'}" data-sp="sub" data-v="${k}">${n}</button>`).join('')}</div>` +
    (SP.sub === 'locales' ? adminLocalesHTML() : SP.sub === 'revisar' ? spRevisarHTML() : spChatHTML());
}

function spRevisarHTML() {
  const ls = S.av.locales || [];
  if (!S.av.cargado) return '<p class="mut">Cargando locales…</p>';
  const sel = `<div class="card" style="margin-bottom:12px"><b>Elige el local que quieres revisar</b>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${ls.map(l => `<button class="${SP.lid === l.id ? 'btn' : 'btn-line'}" data-sp="rev" data-lid="${l.id}">${esc(l.nombre)}</button>`).join('') || '<span class="mut">Aún no hay locales.</span>'}</div>
    <div class="hint" style="margin-top:10px">Modo lectura: aquí puedes ver todo lo que ve el local sin modificar nada. Los PIN no se muestran.</div></div>`;
  if (!SP.lid) return sel;
  if (SP.load) return sel + '<p class="mut">Cargando datos del local…</p>';
  if (SP.err) return sel + `<div class="card" style="color:var(--bad)">${esc(SP.err)}<div class="hint" style="margin-top:8px;color:var(--mut)">Si dice "permission denied" o no trae datos, falta ejecutar la migración resto_migracion_soporte.sql en Supabase.</div></div>`;
  const d = SP.d; if (!d) return sel;
  const tabs = [['resumen', 'Resumen'], ['diag', 'Diagnóstico' + (d.diag.filter(x => x.n !== 'ok').length ? ' ⚠' + d.diag.filter(x => x.n !== 'ok').length : '')], ['ventas', 'Ventas'], ['coms', 'Comandas abiertas'], ['carta', 'Carta'], ['equipo', 'Equipo'], ['inv', 'Inventario'], ['resv', 'Reservas'], ['cajas', 'Cajas y sesiones']];
  const nav = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${tabs.map(([k, n]) => `<button class="${SP.tab === k ? 'btn' : 'btn-line'}" style="padding:7px 12px" data-sp="tab" data-v="${k}">${n}</button>`).join('')}</div>`;
  const body = { resumen: spResumen, diag: spDiag, ventas: spVentas, coms: spComs, carta: spCarta, equipo: spEquipo, inv: spInv, resv: spResv, cajas: spCajas }[SP.tab](d);
  return sel + `<h2>${esc(d.loc.nombre)} <span class="pill">${d.loc.mesas} mesas${d.loc.mesas2 ? ' + ' + d.loc.mesas2 + ' piso 2' : ''}</span> <button class="btn-line" style="padding:5px 10px;margin-left:6px" data-sp="rev" data-lid="${SP.lid}">Actualizar</button></h2>` + nav + body;
}

const tabla = (heads, rows) => rows.length ? `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.9rem"><thead><tr>${heads.map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--line);color:var(--mut);font-size:.75rem;text-transform:uppercase;white-space:nowrap">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 8px;border-bottom:1px solid var(--line)">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="mut">Sin registros.</p>';

async function spCargarLocal(lid) {
  SP.lid = lid; SP.load = true; SP.err = ''; SP.d = null; render();
  try {
    const desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - (SP.dias - 1));
    const hoy = fechaIso(new Date());
    const q = (t, f) => f(sb.from(t).select('*').eq(t === 'resto_locales' ? 'id' : 'local_id', lid));
    const [loc, menu, com, cue, gar, coc, tur, ped, res, ses, gas] = await Promise.all([
      q('resto_locales', x => x.single()),
      q('resto_menu', x => x.order('categoria').order('nombre')),
      q('resto_comandas', x => x.eq('cerrada', false).order('created_at')),
      q('resto_cuentas', x => x.gte('created_at', desde.toISOString()).order('created_at', { ascending: false }).limit(2000)),
      q('resto_garzones', x => x.order('nombre')),
      q('resto_cocineras', x => x.order('nombre')),
      q('resto_turnos', x => x.order('abierto_at', { ascending: false }).limit(15)),
      q('resto_pedidos', x => x.eq('cerrado', false).order('num')),
      q('resto_reservas', x => x.gte('fecha', hoy).order('fecha').order('hora')),
      q('resto_sesiones', x => x.order('entrada', { ascending: false }).limit(60)),
      q('resto_gastos', x => x.order('created_at', { ascending: false }).limit(100))
    ]);
    if (loc.error) throw new Error(loc.error.message || 'No se pudo leer el local');
    const err = [menu, com, cue, gar, tur, ped, res, ses].find(r => r.error);
    if (err) throw new Error(err.error.message);
    const d = { loc: loc.data, menu: menu.data || [], com: com.data || [], cue: cue.data || [], gar: gar.data || [], coc: (coc && coc.data) || [], tur: tur.data || [], ped: ped.data || [], res: res.data || [], ses: ses.data || [], gas: (gas && gas.data) || [] };
    d.usuarios = ((S.av.locales || []).find(l => l.id === lid) || {}).usuarios || [];
    d.diag = spDiagnostico(d);
    SP.d = d;
  } catch (e) { SP.err = 'No se pudo cargar: ' + e.message; }
  SP.load = false; render();
}

function spDiagnostico(d) {
  const r = [], add = (n, t) => r.push({ n, t });
  const l = d.loc;
  if (!(l.mesas > 0)) add('bad', 'El local tiene 0 mesas configuradas.');
  if (!d.menu.length) add('bad', 'La carta está vacía: no se pueden tomar pedidos.');
  const sinPrecio = d.menu.filter(i => !(i.precio > 0)); if (sinPrecio.length) add('bad', sinPrecio.length + ' producto(s) con precio 0 o vacío: ' + sinPrecio.slice(0, 4).map(i => i.nombre).join(', ') + '.');
  const off = d.menu.filter(i => i.activo === false).length; if (off) add('warn', off + ' producto(s) marcados como agotados/inactivos en la carta.');
  const bajo = d.menu.filter(i => i.stock != null && i.stock <= (i.stock_min || 0)); if (bajo.length) add('warn', bajo.length + ' producto(s) con stock bajo o en cero: ' + bajo.slice(0, 4).map(i => i.nombre).join(', ') + '.');
  if (!l.admin_pin) add('warn', 'No hay PIN de administradora: todos ven todo y no se registra quién cobra.');
  else {
    const sp = d.gar.filter(g => g.activo && !g.pin); if (sp.length) add('warn', 'Garzón(es) activos sin PIN (no pueden entrar): ' + sp.map(g => g.nombre).join(', ') + '.');
    if (!d.gar.some(g => g.activo)) add('warn', 'Hay PIN de administradora pero ningún garzón activo.');
  }
  const viejas = d.com.filter(c => Date.now() - new Date(c.created_at).getTime() > 4 * 3600000);
  if (viejas.length) add('warn', viejas.length + ' comanda(s) abiertas hace más de 4 horas (mesas olvidadas sin cobrar): ' + viejas.slice(0, 4).map(c => nmesa(c.mesa)).join(', ') + '.');
  const ta = d.tur.find(t => !t.cerrado_at);
  if (ta && Date.now() - new Date(ta.abierto_at).getTime() > 16 * 3600000) add('warn', 'Turno de caja abierto hace ' + hace(ta.abierto_at) + ': parece que no se cerró la caja.');
  const dif = d.tur.filter(t => t.cerrado_at && t.diferencia && Math.abs(t.diferencia) >= 1000).slice(0, 5);
  if (dif.length) add('warn', 'Diferencias de caja en turnos recientes: ' + dif.map(t => fdia(t.abierto_at) + ' ' + money(t.diferencia)).join(' · ') + '.');
  const sesAb = d.ses.filter(s => !s.salida && Date.now() - new Date(s.entrada).getTime() > 16 * 3600000); if (sesAb.length) add('warn', sesAb.length + ' sesión(es) de caja sin salida de hace más de 16 h (normal si olvidaron cerrar con "Salir").');
  const pend = d.usuarios.filter(u => !u.confirmado); if (pend.length) add('warn', 'Invitación pendiente de aceptar: ' + pend.map(u => u.email).join(', ') + '.');
  if (!d.usuarios.length) add('bad', 'El local no tiene usuarios asignados: nadie puede entrar.');
  if (!r.length) add('ok', 'Todo en orden: no se detectaron problemas de configuración ni de operación.');
  return r;
}

const sumaD = (cs, f) => cs.reduce((a, c) => a + (+f(c) || 0), 0);
function spResumen(d) {
  const hoy = fechaIso(new Date()), ch = c => fechaIso(new Date(c.created_at));
  const cH = d.cue.filter(c => ch(c) === hoy), tot = sumaD(cH, c => c.total);
  const por = m => sumaD(cH.filter(c => (c.metodo || '').toLowerCase().startsWith(m)), c => c.total);
  const ta = d.tur.find(t => !t.cerrado_at);
  const ocupadas = new Set(d.com.map(c => c.mesa)).size;
  const st = (n, v, s) => `<div class="card stat"><span class="mut">${n}</span><b>${v}</b>${s ? `<span class="mut">${s}</span>` : ''}</div>`;
  const ult = d.ses.filter(s => s.rol !== 'cocina').slice(0, 1)[0];
  return `<div class="stats">${st('Ventas de hoy', money(tot), cH.length + ' cuentas')}${st('Efectivo / Tarjeta / Transf.', money(por('efec')) + ' · ' + money(por('tarj')) + ' · ' + money(por('transf')))}${st('Propinas hoy', money(sumaD(cH, c => c.propina)), 'efectivo ' + money(sumaD(cH, c => c.propina_efec)) + ' · tarjeta ' + money(sumaD(cH, c => c.propina_tarj)))}${st('Mesas ocupadas', ocupadas + ' de ' + ((d.loc.mesas || 0) + (d.loc.mesas2 || 0)), d.ped.length + ' pedidos para llevar/delivery abiertos')}${st('Caja', ta ? 'Abierta' : 'Cerrada', ta ? 'por ' + esc(ta.abierto_por || '—') + ' hace ' + hace(ta.abierto_at) : (d.tur[0] ? 'último cierre ' + fdt(d.tur[0].cerrado_at) : 'sin turnos'))}${st('Última actividad', ult ? fdt(ult.entrada) : '—', ult ? esc(ult.usuario) : '')}</div>
    <div class="card"><b>Diagnóstico rápido</b>${d.diag.slice(0, 5).map(spDiagFila).join('')}<button class="btn-line" style="margin-top:8px" data-sp="tab" data-v="diag">Ver todo el diagnóstico</button></div>`;
}
const spDiagFila = x => `<div class="row"><div>${x.n === 'ok' ? '✅' : x.n === 'warn' ? '⚠️' : '⛔'} ${esc(x.t)}</div></div>`;
function spDiag(d) { return `<div class="card"><b>Diagnóstico del local</b>${d.diag.map(spDiagFila).join('')}</div>`; }

function spVentas(d) {
  const dias = {};
  d.cue.forEach(c => { const k = fechaIso(new Date(c.created_at)); (dias[k] = dias[k] || []).push(c); });
  const filas = Object.keys(dias).sort().reverse().map(k => { const cs = dias[k]; return [k.split('-').reverse().join('/'), cs.length, money(sumaD(cs, c => c.total)), money(sumaD(cs, c => c.propina)), money(sumaD(cs.filter(c => (c.metodo || '').toLowerCase().startsWith('efec')), c => c.total)), money(sumaD(cs.filter(c => (c.metodo || '').toLowerCase().startsWith('tarj')), c => c.total)), money(sumaD(cs.filter(c => (c.metodo || '').toLowerCase().startsWith('transf')), c => c.total))]; });
  const gz = {}; d.cue.forEach(c => { const k = c.garzon || '(sin garzón)'; gz[k] = gz[k] || { n: 0, t: 0, p: 0 }; gz[k].n++; gz[k].t += +c.total || 0; gz[k].p += +c.propina || 0; });
  const ult = d.cue.slice(0, 25).map(c => [fdt(c.created_at), nmesa(c.mesa), esc(c.garzon || '—'), esc(c.metodo || '—'), money(c.total), money(c.propina || 0), esc(c.cobrado_por || '—')]);
  return `<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap"><span class="mut">Últimos ${SP.dias} días</span><button class="btn-line" style="padding:6px 10px" data-sp="dias" data-v="1">Hoy</button><button class="btn-line" style="padding:6px 10px" data-sp="dias" data-v="7">7 días</button><button class="btn-line" style="padding:6px 10px" data-sp="dias" data-v="30">30 días</button><button class="btn" style="padding:6px 10px" data-sp="csv">Descargar CSV</button></div>
    <div class="card" style="margin-bottom:12px"><b>Por día</b>${tabla(['Día', 'Cuentas', 'Total', 'Propinas', 'Efectivo', 'Tarjeta', 'Transf.'], filas)}</div>
    <div class="card" style="margin-bottom:12px"><b>Por garzón</b>${tabla(['Garzón', 'Cuentas', 'Total', 'Propinas'], Object.keys(gz).sort((a, b) => gz[b].t - gz[a].t).map(k => [esc(k), gz[k].n, money(gz[k].t), money(gz[k].p)]))}</div>
    <div class="card"><b>Últimas cuentas</b>${tabla(['Fecha', 'Mesa', 'Garzón', 'Pago', 'Total', 'Propina', 'Cobró'], ult)}</div>`;
}
function spCsv() {
  const d = SP.d; if (!d) return;
  const c = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  const filas = [['Fecha', 'Mesa', 'Garzon', 'Metodo', 'Total', 'Propina', 'Propina efectivo', 'Propina tarjeta', 'Cobrado por', 'Detalle'].map(c).join(';')]
    .concat(d.cue.map(x => [fdt(x.created_at), nmesa(x.mesa), x.garzon, x.metodo, x.total, x.propina || 0, x.propina_efec || 0, x.propina_tarj || 0, x.cobrado_por, (x.items || []).map(i => (i.q || 1) + 'x ' + (i.n || '')).join(' | ')].map(c).join(';')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + filas.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = 'ventas-' + (d.loc.nombre || 'local').replace(/\W+/g, '-') + '-' + fechaIso(new Date()) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function spComs(d) {
  return `<div class="card"><b>Comandas abiertas (${d.com.length})</b>${tabla(['Mesa', 'Garzón', 'Estado', 'Hace', 'Pedido', 'Nota'], d.com.map(c => [nmesa(c.mesa), esc(c.garzon || '—'), esc(c.estado || '—'), hace(c.created_at), (c.items || []).map(i => (i.q || 1) + '× ' + esc(i.n || '')).join(', '), esc(c.nota || '')]))}</div>
    ${d.ped.length ? `<div class="card" style="margin-top:12px"><b>Para llevar / delivery abiertos</b>${tabla(['#', 'Tipo', 'Cliente', 'Teléfono', 'Dirección'], d.ped.map(p => [p.num - 1000, esc(p.tipo), esc(p.cliente || ''), esc(p.telefono || ''), esc(p.direccion || '')]))}</div>` : ''}`;
}
function spCarta(d) {
  return `<div class="card"><b>Carta (${d.menu.length} productos)</b>${tabla(['Producto', 'Categoría', 'Precio', 'Estación', 'Estado', 'Código'], d.menu.map(i => [esc(i.nombre), esc(i.categoria || ''), money(i.precio), i.estacion === 'cafeteria' ? '☕ Cafetería' : 'Cocina', i.activo === false ? '<span class="pill">Agotado</span>' : 'Disponible', esc(i.codigo || '')]))}</div>`;
}
function spEquipo(d) {
  return `<div class="card" style="margin-bottom:12px"><b>Usuarios con acceso al local</b>${tabla(['Correo', 'Estado'], d.usuarios.map(u => [esc(u.email), u.confirmado ? 'Activo' : 'Invitación pendiente']))}</div>
    <div class="card" style="margin-bottom:12px"><b>Garzones</b>${tabla(['Nombre', 'Activo', 'PIN', 'Cobra en caja'], d.gar.map(g => [esc(g.nombre), g.activo ? 'Sí' : 'No', g.pin ? 'Asignado' : '<b style="color:var(--bad)">Sin PIN</b>', g.caja === false ? 'No' : 'Sí']))}</div>
    <div class="card"><b>Cocineras</b>${tabla(['Nombre', 'Activa', 'PIN'], d.coc.map(g => [esc(g.nombre), g.activo ? 'Sí' : 'No', g.pin ? 'Asignado' : 'Sin PIN']))}<div class="hint" style="margin-top:8px">PIN de administradora: ${d.loc.admin_pin ? 'configurado' : '<b>no configurado</b>'}.</div></div>`;
}
function spInv(d) {
  const it = d.menu.filter(i => i.stock != null);
  return `<div class="card"><b>Inventario (${it.length} productos con control de stock)</b>${tabla(['Producto', 'Stock', 'Mínimo', 'Estado'], it.map(i => [esc(i.nombre), i.stock, i.stock_min || 0, i.stock <= (i.stock_min || 0) ? '<b style="color:var(--bad)">Bajo</b>' : 'OK']))}</div>`;
}
function spResv(d) {
  return `<div class="card"><b>Reservas desde hoy</b>${tabla(['Fecha', 'Hora', 'Nombre', 'Personas', 'Mesa', 'Estado'], d.res.map(r => [r.fecha.split('-').reverse().join('/'), esc(r.hora), esc(r.nombre), r.personas, r.mesa ? nmesa(r.mesa) : '—', esc(r.estado)]))}</div>`;
}
function spCajas(d) {
  return `<div class="card" style="margin-bottom:12px"><b>Turnos de caja recientes</b>${tabla(['Abrió', 'Por', 'Cerró', 'Ventas', 'Cuentas', 'Diferencia', 'Sencillo inicial', 'Efectivo contado', 'Retirado de ventas', 'Quedó en caja', 'Gastos', 'Propinas pagadas'], d.tur.map(t => [fdt(t.abierto_at), esc(t.abierto_por || '—'), t.cerrado_at ? fdt(t.cerrado_at) : '<span class="pill">Abierto</span>', t.ventas_total != null ? money(t.ventas_total) : '—', t.cuentas ?? '—', t.diferencia != null ? money(t.diferencia) : '—', esc(typeof dnTxt === 'function' ? dnTxt(t.desglose_apertura) : ''), esc(typeof dnTxt === 'function' ? dnTxt((t.desglose_cierre || {}).efectivo) : ''), t.retiro_efectivo != null ? money(t.retiro_efectivo) : '—', esc(typeof dnTxt === 'function' ? dnTxt(t.desglose_deja) : ''), t.gastos_total ? money(t.gastos_total) : '—', t.propinas_pagadas != null ? money(t.propinas_pagadas) + ((t.pago_propinas || []).length ? ' · ' + t.pago_propinas.map(x => esc(x.n) + ' ' + money(x.m)).join(', ') : '') : '—']))}</div>
    <div class="card" style="margin-bottom:12px"><b>Gastos pagados desde caja</b>${tabla(['Fecha', 'Documento', 'N°', 'Proveedor', 'Detalle', 'Monto', 'Registró', 'Estado'], d.gas.map(g => [fdt(g.created_at), esc(g.tipo || ''), esc(g.numero || '—'), esc(g.proveedor || ''), esc(g.detalle || ''), money(g.monto), esc(g.registrado_por || ''), g.anulado ? 'Anulado por ' + esc(g.anulado_por || '') + ': ' + esc(g.anulado_motivo || '') : g.anul_pedida_motivo ? 'Anulación pedida' : 'Vigente']))}</div>
    <div class="card"><b>Quién entró (sesiones recientes)</b>${tabla(['Usuario', 'Rol', 'Entrada', 'Salida'], d.ses.map(s => [esc(s.usuario), esc(s.rol || ''), fdt(s.entrada), s.salida ? fdt(s.salida) : '<span class="pill">Conectado</span>']))}</div>`;
}

/* ---------- Bandeja del chat (soporte) ---------- */
const spNombreLocal = id => ((S.av.locales || []).find(l => l.id === id) || {}).nombre || 'Local';
function spHilos() {
  const h = {};
  SP.chat.msgs.forEach(m => { const x = h[m.local_id] = h[m.local_id] || { lid: m.local_id, msgs: [], pend: 0 }; x.msgs.push(m); if (m.autor === 'cliente' && m.humano && !m.visto_soporte) x.pend++; });
  return Object.values(h).map(x => ({ ...x, ult: x.msgs[x.msgs.length - 1] })).sort((a, b) => (b.pend - a.pend) || (new Date(b.ult.created_at) - new Date(a.ult.created_at)));
}
const spPendientes = () => S.admin ? spHilos().filter(h => h.pend).length : 0;
function spChatHTML() {
  if (SP.chat.err) return `<div class="card" style="color:var(--bad)">${esc(SP.chat.err)}<div class="hint" style="margin-top:8px;color:var(--mut)">Falta ejecutar la migración resto_migracion_soporte.sql en Supabase.</div></div>`;
  if (!SP.chat.cargado) return '<p class="mut">Cargando conversaciones…</p>';
  const hs = spHilos(), sel = hs.find(h => h.lid === SP.chat.sel);
  const lista = hs.map(h => `<button class="mesa" style="width:100%;text-align:left;padding:10px;${h.lid === SP.chat.sel ? 'border-color:var(--brand);background:var(--soft);' : ''}" data-sp="hilo" data-lid="${h.lid}"><b style="font-size:1rem;text-align:left">${esc(spNombreLocal(h.lid))}${h.pend ? ` <span class="pill" style="background:var(--bad);color:#fff">${h.pend} nuevo(s)</span>` : ''}</b><span>${esc((h.ult.autor === 'soporte' ? 'Tú: ' : '') + h.ult.texto.slice(0, 70))} · ${fdt(h.ult.created_at)}</span></button>`).join('') || '<p class="mut">Aún no hay conversaciones. Cuando un local escriba en el chat, aparecerá aquí.</p>';
  const conv = sel ? `<div class="card" style="display:flex;flex-direction:column;gap:10px"><b>${esc(spNombreLocal(sel.lid))}</b>
      <div id="sp-msgs" style="max-height:52vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px">${sel.msgs.map(chatBurbuja).join('')}</div>
      <div style="display:flex;gap:8px"><input id="sp-reply" data-keep placeholder="Escribe tu respuesta al local…" value="${fv('sp-reply')}" autocomplete="off"><button class="btn" data-sp="resp">Enviar</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn-line" style="padding:6px 10px" data-sp="rev" data-lid="${sel.lid}" data-go="1">Revisar este local</button></div></div>` : '<div class="card"><p class="mut">Elige una conversación de la izquierda.</p></div>';
  return `<div class="cols2"><div style="display:grid;gap:8px;align-content:start">${lista}</div>${conv}</div>`;
}
async function spChatCargar() {
  const r = await sb.from('resto_chat').select('*').order('created_at', { ascending: false }).limit(600);
  if (r.error) { SP.chat.err = 'No se pudo leer el chat: ' + r.error.message; SP.chat.cargado = true; render(); return; }
  SP.chat.err = ''; SP.chat.msgs = (r.data || []).reverse(); SP.chat.cargado = true; render();
}
function spSuscribir() {
  if (SP.ch) return;
  SP.ch = sb.channel('soporte-chat').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'resto_chat' }, p => {
    const m = p.new; if (!m || SP.chat.msgs.some(x => x.id === m.id)) return;
    SP.chat.msgs.push(m);
    if (m.autor === 'cliente' && m.humano) { toast('💬 ' + spNombreLocal(m.local_id) + ': ' + m.texto.slice(0, 80), 'tk-l'); try { sonarListo(); } catch (e) {} }
    render();
  }).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'resto_chat' }, p => { const m = p.new, i = SP.chat.msgs.findIndex(x => x.id === m.id); if (i >= 0) { SP.chat.msgs[i] = m; render(); } }).subscribe();
}
async function spMarcarVistos(lid) {
  const pend = SP.chat.msgs.filter(m => m.local_id === lid && m.autor === 'cliente' && !m.visto_soporte);
  if (!pend.length) return;
  pend.forEach(m => { m.visto_soporte = true; });
  await sb.from('resto_chat').update({ visto_soporte: true }).eq('local_id', lid).eq('autor', 'cliente').eq('visto_soporte', false);
}

/* ---------- Acciones del portal ---------- */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-sp]'); if (!b) return;
  const a = b.dataset.sp, d = b.dataset;
  try {
    if (a === 'sub') { SP.sub = d.v; if (d.v === 'chat') { if (!SP.chat.cargado) spChatCargar(); if (SP.chat.sel) spMarcarVistos(SP.chat.sel); } render(); }
    else if (a === 'rev') { SP.sub = 'revisar'; await spCargarLocal(d.lid); }
    else if (a === 'tab') { SP.tab = d.v; render(); }
    else if (a === 'dias') { SP.dias = +d.v; await spCargarLocal(SP.lid); SP.tab = 'ventas'; render(); }
    else if (a === 'csv') spCsv();
    else if (a === 'hilo') { SP.chat.sel = d.lid; await spMarcarVistos(d.lid); render(); }
    else if (a === 'resp') {
      const t = (S.f['sp-reply'] || '').trim(); if (!t || !SP.chat.sel) return;
      delete S.f['sp-reply'];
      const r = await sb.from('resto_chat').insert({ local_id: SP.chat.sel, autor: 'soporte', quien: 'Soporte Protech', texto: t, visto_soporte: true }).select().single();
      if (r.error) { toast('No se pudo enviar: ' + r.error.message, 'tk-c'); S.f['sp-reply'] = t; }
      else if (!SP.chat.msgs.some(x => x.id === r.data.id)) SP.chat.msgs.push(r.data);
      render();
    }
  } catch (x) { console.error(x); toast('Error: ' + (x.message || x), 'tk-c'); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target && e.target.id === 'sp-reply') { e.preventDefault(); const b = document.querySelector('[data-sp="resp"]'); if (b) b.click(); } });

/* =====================================================
   GUÍA DE AYUDA (la usa Robi)
   ===================================================== */

/* ---------- Guía del sistema: el asistente responde con esto ---------- */
const normTxt = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
const KB = [
  { k: ['entrar', 'ingresar', 'login', 'iniciar sesion', 'correo y clave', 'no puedo entrar', 'acceso', 'contrasena', 'clave'], r: 'Para entrar usa el correo y la clave de tu local (las cuentas las crea Protech). Si es tu primera vez o olvidaste la clave, toca "Primera vez o olvidé mi clave", escribe el correo del local y te llega un enlace para crear una clave nueva (revisa también spam). Después de entrar, cada persona elige su nombre y pone su PIN.' },
  { k: ['se cierra', 'se sale', 'me saca', 'pide clave', 'pide pin', 'sesion', 'cierra sola', 'tengo que entrar otra vez'], r: 'La sesión se mantiene abierta por 16 horas desde el último uso. Si te pide entrar de nuevo: recarga la página una vez para tomar la última versión y revisa que tengas internet estable. Si sigue pasando, escríbenos y lo revisamos: toca "Hablar con una persona".' },
  { k: ['pin', 'quien eres', 'quién eres', 'olvide mi pin', 'cambiar pin', 'crear pin', 'asignar pin'], r: 'Si el local tiene PIN de administradora, cada persona elige quién es y entra con su PIN. La administradora ve todo; los garzones solo Mesas (toman pedidos y cobran sus mesas); la cocina solo Cocina y Cafetería. La administradora crea y asigna los PIN en la pestaña "Garzones". Si olvidaste tu PIN, pídele a la administradora que te asigne uno nuevo.' },
  { k: ['tomar pedido', 'tomar un pedido', 'nuevo pedido', 'abrir mesa', 'pedido de mesa', 'agregar productos', 'enviar pedido', 'enviar a cocina', 'comanda'], r: 'Para tomar un pedido: en "Mesas" toca la mesa, elige los productos (puedes agregar una nota) y toca Enviar. Lo de cocina llega a la pantalla de Cocina con sonido; lo de cafetería (cafés y bebidas calientes) sale directo de la mesa como entregado, sin que tengas que marcar nada.' },
  { k: ['cobrar', 'cobro', 'como cobro', 'como cobrar', 'cobrar una mesa', 'cerrar mesa', 'cerrar cuenta', 'pagar', 'pago', 'cuenta de la mesa', 'cobrar mesa'], r: 'Para cobrar: abre la mesa en "Mesas" y toca Cobrar. Elige cómo paga el cliente (efectivo, tarjeta o transferencia). En efectivo escribes cuánto te entrega y la app calcula el vuelto; en tarjeta queda indicado; en transferencia te recuerda confirmar que llegó. Antes de cobrar puedes anotar la propina. Cada garzón cobra las mesas que él tomó.' },
  { k: ['propina', 'propinas', 'recargo', 'tarjeta propina'], r: 'Al cobrar hay dos recuadros: propina en efectivo (el cliente se la da directo al garzón; no se suma al total) y propina o recargo con tarjeta (se suma a la cuenta). Quedan registradas por garzón en los reportes y en el CSV de ventas.' },
  { k: ['pago parcial', 'pagar parte', 'se retira', 'se fue', 'dividir', 'separar cuenta', 'cuenta compartida', 'grupo de amigos', 'pago por producto'], r: 'Si en una mesa compartida alguien se retira antes, en el cobro elige "pagar por producto", marca lo que consumió esa persona y cóbralo. Eso se descuenta del total de la mesa y el resto sigue abierto para los demás.' },
  { k: ['cafeteria', 'cafe', 'bebida caliente', 'bebidas calientes', 'capuchino', 'cappuccino', 'estacion'], r: 'En "Carta y mesas" cada producto tiene una estación: Cocina o Cafetería. Los cafés y bebidas calientes se marcan como Cafetería: los preparan los garzones y salen directo de la mesa, sin pasar por cocina. La pestaña "Cafetería" muestra esos pedidos.' },
  { k: ['cocina', 'cocinera', 'cocineras', 'pantalla de cocina', 'comandas de cocina', 'marcar listo', 'listo', 'preparando'], r: 'La pantalla "Cocina" muestra las comandas que llegan. La cocinera marca cuando están listas y a los garzones les avisa con sonido que pueden llevarlas a la mesa. Para el dispositivo fijo de la cocina, la administradora crea las cocineras con PIN; ese equipo queda abierto y vuelve solo a Cocina si se recarga. Toca el botón de activar sonido una vez.' },
  { k: ['sonido', 'alerta', 'aviso', 'no suena', 'no me suena', 'suena', 'no escucho', 'no se escucha', 'escucho', 'ruido', 'volumen', 'notificacion', 'notificaciones'], r: 'Arriba hay un botón "Sonido". Tócalo para activarlo (los navegadores exigen un toque primero). En la cocina aparece un botón grande azul para activar el sonido de las comandas. Revisa también el volumen del equipo y que la pestaña esté abierta. La administradora recibe todas las notificaciones.' },
  { k: ['mostrador', 'venta mostrador', 'vender sin mesa', 'venta directa'], r: 'La venta por mostrador (productos sin mesa) la hacen la administradora y los garzones autorizados con PIN. Entra a "Mesas" y toca "+ Venta mostrador". Puedes buscar productos por nombre o escanear el código de barras. La administradora autoriza a cada garzón desde la pestaña "Garzones".' },
  { k: ['codigo de barras', 'codigo barras', 'lector', 'escanear', 'escaner', 'pistola'], r: 'Con un lector de código de barras conectado al PC puedes escanear productos en la venta por mostrador y en Inventario (para ingresar stock o crear productos nuevos). Haz clic en el campo de escaneo y escanea. Si el código no existe, la app te ofrece registrarlo. Cada producto tiene su código en el campo "Código".' },
  { k: ['inventario', 'stock', 'bajo stock', 'agotado', 'cantidad disponible', 'editar precio', 'cambiar precio', 'precio'], r: 'En "Inventario" ves el stock de cada producto, ingresas mercadería (por código de barras o a mano) y puedes corregir el precio de un producto. Cuando el stock llega al mínimo aparece una alerta en la pestaña. Los productos agotados dejan de poder pedirse. Los precios y la carta también se editan en "Carta y mesas".' },
  { k: ['carta', 'menu', 'agregar producto', 'nuevo producto', 'crear producto', 'quitar producto', 'categoria', 'categorias'], r: 'La carta se edita en "Carta y mesas": agrega productos con nombre, categoría, precio, estación (Cocina o Cafetería) y, si quieres, código de barras y stock. Puedes marcar un producto como agotado sin borrarlo. Allí mismo configuras la cantidad de mesas del local y las del segundo piso.' },
  { k: ['mesas', 'numero de mesas', 'cantidad de mesas', 'segundo piso', 'piso 2', 'agregar mesa', 'mas mesas'], r: 'La cantidad de mesas (y las del segundo piso) se configura en "Carta y mesas". El segundo piso aparece como "Piso 2 · Mesa N" en toda la app.' },
  { k: ['garzon', 'garzones', 'agregar garzon', 'nuevo garzon', 'quitar garzon', 'mesero', 'meseros'], r: 'Los garzones se crean en la pestaña "Garzones" (solo la administradora): agrega el nombre, asígnale un PIN y, si corresponde, autorízalo para cobrar por mostrador. Cada mesa solo la maneja el garzón que la tomó, y un garzón sin PIN no puede entrar a mesas de otros.' },
  { k: ['caja', 'turno', 'abrir caja', 'cerrar caja', 'cierre de caja', 'monto inicial', 'arqueo', 'diferencia de caja', 'sencillo', 'billetes', 'monedas', 'cuadrar', 'cuadre'], r: 'En la pestaña "Caja" la administradora y los garzones autorizados abren y cierran la caja. Al abrir cuentas el sencillo y escribes en pesos cuánto hay de cada billete ($20.000, $10.000, $5.000, $2.000 y $1.000) y moneda ($500, $100, $50 y $10); por ejemplo, 4 billetes de $20.000 se anotan como 80000, y la app te muestra cuántos billetes son. Al cerrar vuelves a contar el efectivo y anotas en pesos el total de cada tipo, anotas el total de tarjetas según el terminal y las transferencias recibidas, y la app te muestra si cuadra con lo vendido. Si hay diferencia debes escribir una observación. Queda registrado quién abrió y cerró cada turno.' },
  { k: ['ventas', 'reporte', 'reportes', 'informe', 'total del dia', 'cuanto vendi', 'ventas del dia', 'csv', 'excel', 'descargar'], r: 'La pestaña "Ventas" (solo administradora) muestra las ventas del día y reportes por fechas, por garzón y por método de pago, con propinas. Puedes descargar un CSV para abrirlo en Excel.' },
  { k: ['comandas enviadas', 'revisar comandas', 'error de venta', 'errores', 'historial de comandas', 'que pidio'], r: 'En la pestaña "Comandas" la administradora puede revisar todas las comandas enviadas por cada garzón, útil para detectar errores en ventas.' },
  { k: ['reserva', 'reservas', 'reservar mesa'], r: 'En "Reservas" anotas fecha, hora, nombre, personas y mesa. La mesa aparece como "Reservada" en el plano de Mesas y la administradora recibe un aviso unos minutos antes de la hora.' },
  { k: ['delivery', 'para llevar', 'llevar', 'domicilio', 'pedido para llevar'], r: 'En "Mesas", sobre el plano, hay botones "+ Para llevar" y "+ Delivery". Escribe nombre, teléfono (y dirección en delivery), toma el pedido como una mesa y cóbralo igual. Los pedidos abiertos aparecen listados con su número.' },
  { k: ['mesa ocupada', 'mesa de otro', 'no puedo abrir la mesa', 'mesa no me deja', 'otro garzon'], r: 'Cada mesa la maneja el garzón que tomó el pedido. Si necesitas ayudar en una mesa de otro garzón, la administradora (o un garzón autorizado con PIN) puede abrirla y cobrarla.' },
  { k: ['no carga', 'no abre', 'pantalla en blanco', 'lento', 'error', 'falla', 'problema', 'no funciona', 'internet', 'sin conexion'], r: 'Prueba esto: 1) recarga la página; 2) revisa que el equipo tenga internet; 3) cierra y vuelve a abrir el navegador. La app necesita conexión para funcionar y se actualiza sola al volver el internet. Si el problema sigue, toca "Hablar con una persona" y cuéntanos qué pasó.' },
  { k: ['celular', 'telefono', 'instalar', 'app', 'pwa', 'computador', 'pc', 'tablet', 'dispositivo'], r: 'Protech Resto es una página web: funciona en celular, tablet y PC con solo abrir resto.protechdigital.cl en el navegador. Puedes agregarla a la pantalla de inicio del celular desde el menú del navegador. Cada persona entra con su PIN en su propio equipo.' },
  { k: ['cuenta nueva', 'nuevo local', 'otro local', 'contratar', 'precio del sistema', 'cuanto cuesta', 'plan', 'suscripcion', 'factura'], r: 'Para nuevos locales, planes o temas de pago escríbele a Protech por WhatsApp: +56 9 3947 3588. Las cuentas las crea Protech (no hay registro público) y cada local ve solo sus propios datos.' },
  { k: ['borrar', 'eliminar', 'anular', 'me equivoque', 'error en el pedido', 'quitar item', 'corregir pedido'], r: 'Si te equivocaste en un pedido que aún no se cobró, ábrelo desde "Mesas" y corrígelo antes de cobrar. Para anular ventas ya cobradas o corregir datos, avisa a la administradora o escríbenos con "Hablar con una persona" para revisarlo juntos.' }
];
const SALUDO = /^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|ayuda|help)\b/;
function chatBot(texto) {
  const t = normTxt(texto);
  if (SALUDO.test(t) && t.split(' ').length <= 3) return { ok: true, r: '¡Hola! Soy Robi, tu ayudante de Protech Resto. Pregúntame cómo tomar pedidos, cobrar, usar caja, inventario, reportes, PIN… Si no sé algo, te conecto con una persona de soporte.' };
  if (/(gracias|muchas gracias|ok gracias|listo gracias)/.test(t) && t.split(' ').length <= 4) return { ok: true, r: '¡De nada! Si necesitas algo más, aquí estoy.' };
  let best = null, bs = 0;
  KB.forEach(e => { let s = 0; e.k.forEach(k => { if (t.includes(normTxt(k))) s += k.includes(' ') ? 3 : 2; }); if (s > bs) { bs = s; best = e; } });
  return bs >= 2 ? { ok: true, r: best.r, s: bs } : { ok: false };
}

/* ---------- Interfaz del chat ---------- */
function chatBurbuja(m) {
  const mio = m.autor === 'cliente', soporte = m.autor === 'soporte';
  const quien = soporte ? 'Soporte Protech' : m.autor === 'bot' ? 'Asistente' : (m.quien || 'Local');
  const esSoporteVista = typeof S !== 'undefined' && S.admin;
  const der = esSoporteVista ? soporte : mio;
  return `<div style="align-self:${der ? 'flex-end' : 'flex-start'};max-width:85%"><div style="font-size:.7rem;color:var(--mut);margin:0 6px 2px;text-align:${der ? 'right' : 'left'}">${esc(quien)} · ${fdt(m.created_at)}</div>
    <div style="padding:9px 12px;border-radius:14px;line-height:1.35;font-size:.93rem;${der ? 'background:var(--brand);color:#fff;border-bottom-right-radius:4px' : soporte ? 'background:#dcfce7;border-bottom-left-radius:4px' : 'background:#e2e8f0;border-bottom-left-radius:4px'}">${esc(m.texto).replace(/\n/g, '<br>')}</div></div>`;
}
/* Se llama al final de cada render(): decide qué chat mostrar según quién entró */
function chatSync() {
  /* El chat de ayuda del lado del local ya no existe: la ayuda es Robi (ver app.js). Aquí queda solo la bandeja de soporte (historial). */
  if (S.admin && S.user) { if (!SP.ch) { spSuscribir(); if (!SP.chat.cargado) spChatCargar(); } }
  else if (SP.ch) { sb.removeChannel(SP.ch); SP.ch = null; SP.chat = { msgs: [], sel: null, cargado: false, err: '' }; SP.d = null; SP.lid = null; }
  const m = document.getElementById('sp-msgs'); if (m) m.scrollTop = m.scrollHeight;
}

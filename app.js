/* =====================================================
   PROTECH RESTO — conectado a Supabase
   Cada local entra con su correo y clave (cuentas creadas por Protech)
   y solo ve sus propios datos (seguridad RLS en la base).
   ===================================================== */
const SB_URL = 'https://fchqqtdapyrgpkyxiful.supabase.co';
const SB_KEY = 'sb_publishable_7jjHrGLPJ51aP0BKwcIizg_bakLNqiY';
/* Pase de sesión del rol (lo entrega el servidor al verificar el PIN). Viaja en cada consulta a la base para que ella misma aplique los permisos. */
let RTOK = '';
const sb = supabase.createClient(SB_URL, SB_KEY, { global: { fetch: (u, o = {}) => { if (!RTOK || !String(u).includes('/rest/v1/')) return fetch(u, o); const h = new Headers(o.headers || {}); h.set('x-rol-token', RTOK); return fetch(u, { ...o, headers: h }); } } });
const $ = s => document.querySelector(s);
const money = n => '$' + Math.round(n).toLocaleString('es-CL');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mins = t => Math.max(0, Math.round((Date.now() - t) / 60000));

let D = null; // datos del local: {id,name,mesas,menu,comandas,cuentas}
let S = { garzon: '', rp: null, rpd: null, rph: null, user: null, loading: true, view: 'mesas', mesa: null, cart: {}, note: '', cerrando: false, parcial: false, sel: {}, propina: true, metodo: 'Efectivo', err: '', ok: '', busy: false, setpass: false, olvide: false, admin: false, rol: null, quien: '', f: {}, np: null, th: null, mos: false, ses: null, back: null, qk: null, rc: '', pinErr: '', av: { locales: [], cargado: false, msg: '', err: '' }, af: { nombre: '', mesas: '6', email: '' } };
const L = () => D;
/* Si la base todavía no tiene la columna propina_efec_caja (falta la migración 023), el cobro se guarda igual sin ella */
const sinColPq = c => { const { propina_efec_caja, ...resto } = c; return resto; };
const errPq = r => r && r.error && /propina_efec_caja/i.test(r.error.message || '');
const insertarCuenta = async c => { let r = await sb.from('resto_cuentas').insert(c); if (errPq(r)) r = await sb.from('resto_cuentas').insert(sinColPq(c)); return r; };
const extraCuenta = () => ({ ...(D.turno ? { turno_id: D.turno.id } : {}), ...(S.quien ? { cobrado_por: S.quien } : {}) });
/* ---------- Roles y PIN ----------
   Si el local tiene PIN de administradora, cada persona elige quién es y entra con su PIN.
   Administradora: todo. Garzón: solo Mesas (tomar pedidos y cobrar). Cocina: Cocina y Cafetería.
   Si el local aún no configuró PIN, funciona como siempre (todo visible). */
const rolesOn = () => !!(D && D.adminPin);
const esIng = () => S.rol === 'ingeniero';
const esAdm = () => !rolesOn() || S.rol === 'admin' || esIng();
const TABS = { admin: ['mesas', 'cocina', 'cafe', 'resv', 'turno', 'caja', 'resumen', 'inv', 'prod', 'abast', 'garz', 'coms', 'carta', 'bit'], garzon: ['mesas'], cocina: ['cocina'] };
TABS.ingeniero = TABS.admin; /* Carlos Oporto (Ingeniero de Software): ve todos los paneles */
/* Cobrar en caja: la administradora autoriza a cada garzón (necesita PIN). Los demás toman pedidos pero no cobran. */
const cajaGarzon = () => { const g = D && D.garzones.find(x => x.n === S.quien && x.on); return !!(g && g.pin && g.cj); };
const puedeCobrar = () => !rolesOn() || S.rol === 'admin' || esIng() || (S.rol === 'garzon' && cajaGarzon());
/* Todos los garzones cobran sus mesas; la venta por mostrador y la pestaña Caja son solo para la administradora y los garzones autorizados con PIN */
const puedeCobrarMesa = () => !rolesOn() || S.rol === 'admin' || esIng() || S.rol === 'garzon';
/* Mesas propias: cada mesa es de quien la tomó. Un garzón no entra a la mesa de otro; solo quien tiene caja (PIN autorizado) puede abrirla para cobrarla. */
const duenoMesa = n => ((abiertas(n).find(c => c.garzon) || {}).garzon) || '';
const esGarzonRol = () => rolesOn() && S.rol === 'garzon';
const mesaPropia = n => { const d = duenoMesa(n); return !esGarzonRol() || !d || d === S.quien; };
const puedeVerMesa = n => mesaPropia(n) || cajaGarzon();
const puedeCobrarEsta = n => puedeCobrarMesa() && puedeVerMesa(n);
const misTabs = () => !rolesOn() ? TABS.admin : S.rol === 'garzon' && cajaGarzon() ? ['mesas', 'turno'] : (TABS[S.rol] || []);
async function hpin(scope, pin) {
  const b = new TextEncoder().encode(D.id + ':' + scope + ':' + pin);
  const h = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const sinFuncion = e => !!(e && /does not exist|could not find the function|PGRST202|schema cache/i.test(e.message || ''));
/* Verifica el PIN en el servidor. Devuelve {ok, token, quien, caja} | {ok:false, error} | {legacy:true} si la base aún no tiene la migración 015 */
async function loginRol(rol, ref, pin, temp) {
  const r = await sb.rpc('resto_login', { p_rol: rol, p_ref: ref, p_pin: pin || '', p_temp: !!temp });
  if (r.error && sinFuncion(r.error)) { SIN_PASES = true; try { localStorage.setItem('pr-sp', '1'); } catch (e) {} return { legacy: true }; }
  if (r.error) return { ok: false, error: 'red' };
  SIN_PASES = false; try { localStorage.removeItem('pr-sp'); } catch (e) {}
  return r.data || { ok: false, error: 'pin' };
}
const msgLogin = r => r.error === 'bloqueado' ? 'Demasiados intentos fallidos. Espera 10 minutos o pide ayuda a la administradora.' : r.error === 'red' ? 'No se pudo verificar el PIN. Revisa tu conexión e inténtalo de nuevo.' : r.error === 'sin_pin' ? 'Esa persona aún no tiene PIN. Pide a la administradora que cree uno.' : 'PIN incorrecto';
async function pinSet(rol, ref, pin) {
  const r = await sb.rpc('resto_pin_set', { p_rol: rol, p_ref: ref, p_pin: pin || '' });
  return r;
}
function entrar(rol, quien, tok) {
  RTOK = tok || ''; S.rol = rol; S.quien = quien; S.qk = null; S.pinErr = ''; S.mesa = null;
  S.garzon = rol === 'garzon' ? quien : '';
  S.view = misTabs()[0];
  if (rol !== 'ingeniero') guardarRol(D.id, rol, quien, tok); /* el ingeniero pide su clave cada vez */
  /* el dispositivo de la cocina queda abierto: si se recarga, vuelve solo a Cocina con la misma cocinera */
  try { if (rol === 'cocina') localStorage.setItem('pr-cocina', JSON.stringify({ lid: D.id, quien })); else localStorage.removeItem('pr-cocina'); } catch (e) {}
  S.ses = null; S.mos = false; ensureSes().then(render); pantalla();
}
/* Quién está usando este dispositivo se guarda en el propio equipo (no se pierde al recargar, cambiar de pestaña ni cuando el celular cierra la app).
   Se mantiene 16 h desde la última vez que se usó; "Cambiar" o "Salir" lo borran. */
const ROL_MS = 16 * 3600 * 1000;
function guardarRol(lid, rol, quien, tok) { try { localStorage.setItem('pr-rol', JSON.stringify({ lid, rol, quien, tok: tok === undefined ? RTOK : tok, t: Date.now() })); } catch (e) {} }
const olvidarRol = () => { RTOK = ''; try { sessionStorage.removeItem('pr-rol'); localStorage.removeItem('pr-rol'); localStorage.removeItem('pr-cocina'); } catch (e) {} };
const cocineraValida = q => D.cocineras.length ? D.cocineras.some(c => c.n === q && c.on) : q === 'Cocina';
let SIN_PASES = (() => { try { return localStorage.getItem('pr-sp') === '1'; } catch (e) { return false; } })(); /* verdadero si la base de datos aún no tiene la migración de pases */
function restaurarRol() {
  if (!rolesOn() || S.rol) return;
  try {
    let r = JSON.parse(localStorage.getItem('pr-rol') || 'null');
    if (r && r.rol !== 'cocina' && Date.now() - (r.t || 0) > ROL_MS) { localStorage.removeItem('pr-rol'); r = null; }
    if (!r) { const k = JSON.parse(localStorage.getItem('pr-cocina') || 'null'); if (k) r = { lid: k.lid, rol: 'cocina', quien: k.quien }; }
    if (r && r.lid === D.id && (r.rol === 'admin' || (r.rol === 'cocina' && cocineraValida(r.quien)) || (r.rol === 'garzon' && D.garzones.some(g => g.n === r.quien && g.on)))) {
      if ((r.rol === 'admin' || r.rol === 'garzon') && !r.tok) { /* pase ausente: hay que volver a entrar con PIN (si la base aún no usa pases, ver más abajo) */ if (!SIN_PASES) { localStorage.removeItem('pr-rol'); return; } }
      RTOK = r.tok || ''; S.rol = r.rol; S.quien = r.quien; S.garzon = r.rol === 'garzon' ? r.quien : ''; S.view = misTabs()[0]; guardarRol(r.lid, r.rol, r.quien, r.tok); ensureSes().then(() => {}); pantalla();
      if (r.tok) sb.rpc('resto_sesion_estado').then(x => { if (!x.error && !x.data && rolesOn() && S.rol && S.rol !== 'cocina') { S.rol = null; S.quien = ''; olvidarRol(); render(); } });
    }
  } catch (e) {}
}
function quienHTML() {
  const g = D.garzones.filter(x => x.on), coc = D.cocineras.filter(x => x.on);
  const opt = (k, n, sub) => `<button class="mesa" style="width:100%" data-act="qsel" data-k="${esc(k)}"><b style="font-size:1.1rem">${esc(n)}</b><span>${sub}</span></button>`;
  let sel = '';
  if (S.qk) {
    const ing = S.qk === 'ing', nombre = ing ? 'Carlos Oporto' : S.qk === 'admin' ? 'Administradora' : S.qk.slice(2);
    sel = `<div class="card" style="margin-top:12px;display:grid;gap:10px"><b>${esc(nombre)}</b>
      <label class="mut">${ing ? 'Tu clave' : 'Tu PIN'}<input id="qpin" type="password" ${ing ? 'autocomplete="off" placeholder="Clave"' : 'inputmode="numeric" autocomplete="off" placeholder="••••"'} autofocus></label>
      ${S.pinErr ? `<div style="color:var(--bad);font-size:.9rem">${esc(S.pinErr)}</div>` : ''}
      <div style="display:flex;gap:8px"><button class="btn" style="flex:1" data-act="qok">Entrar</button><button class="btn-line" data-act="qback">Volver</button></div></div>`;
  }
  return `<header><div><b>${esc(D.name)}</b><small>Protech Resto</small></div><nav></nav><button class="btn-line" style="padding:6px 12px" data-act="logout">Salir</button></header>
  <main><h2>¿Quién eres?</h2><div class="grid">${opt('admin', 'Administradora', 'Todo el local')}${g.map(x => opt('g:' + x.n, x.n, 'Mesas y cobros')).join('')}${coc.length ? coc.map(x => opt('c:' + x.n, x.n, 'Cocina · comandas')).join('') : opt('cocina', 'Cocina', 'Comandas')}${opt('ing', 'Carlos Oporto', 'Ingeniero de Software')}</div>${sel}</main>`;
}

const chipsOpc = sel => { const o = [...new Set(sel.flatMap(i => (i.o || '').split(',').map(x => x.trim()).filter(Boolean)))]; return o.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">${o.map(x => `<button class="btn-line" style="padding:4px 10px" data-act="opc" data-o="${esc(x)}">+ ${esc(x)}</button>`).join('')}</div>` : ''; };
const pideOk = t => confirm(t);
const mesasLista = () => { const l = L(), r = []; for (let n = 1; n <= l.mesas; n++) r.push(n); for (let k = 1; k <= l.mesas2; k++) r.push(100 + k); return r; };
const abiertas = m => L().comandas.filter(c => !c.cerrada && c.mesa === m);
/* i.pg = unidades de ese producto que un cliente ya pagó por separado (cobro parcial) */
const totalMesa = m => abiertas(m).reduce((a, c) => a + c.items.reduce((s, i) => s + (i.q - (i.pg || 0)) * i.p, 0), 0);
const pagada = c => c.items.every(i => (i.pg || 0) >= i.q);
/* las mesas del piso 2 se guardan como 101, 102… (así no chocan con las del piso 1) */
const nm = m => {
  if (m === 0) return 'Venta mostrador';
  if (m >= 1000) { const p = (D && D.pedidos || []).find(x => x.num === m); return p ? (p.tipo === 'delivery' ? 'Delivery' : 'Para llevar') + ' #' + (m - 1000) + (p.cliente ? ' · ' + esc(p.cliente) : '') : 'Pedido #' + (m - 1000); }
  return m > 100 ? 'Piso 2 · Mesa ' + (m - 100) : 'Mesa ' + m;
};
const fv = k => esc(S.f[k] ?? '');
const pedDe = n => ((D && D.pedidos) || []).find(p => p.num === n);
const cajaAbierta = () => !rolesOn() || !!D.turno;
const consumirRecetas = pares => { (pares || []).filter(([m]) => D.recetas.some(r => r.m === m)).forEach(([m, q]) => { Promise.resolve(sb.rpc('resto_receta_consumir', { p_menu: m, p_cant: q, p_por: S.quien || '' })).catch(() => {}); }); };
const hoyIso = () => fechaIso(new Date());
const resDe = n => ((D && D.reservas) || []).filter(r => r.mesa === n && r.estado === 'pendiente' && r.fecha === hoyIso()).sort((a, b) => a.hora.localeCompare(b.hora))[0];
/* Orden alfabético (A–Z) sin distinguir mayúsculas ni tildes, y los números en orden natural. Se usa en todos los inventarios. */
const porNombre = (a, b) => String(a.n || '').localeCompare(String(b.n || ''), 'es', { sensitivity: 'base', numeric: true });
const bajoStock = () => L().menu.filter(i => i.s != null && i.s <= i.sm).sort(porNombre);
const hoy = t => new Date(t).toDateString() === new Date().toDateString();

/* ---------- Sonidos y avisos ---------- */
const SNDL = { ambos: 'todo', cocina: 'solo cocina', salon: 'solo salón', off: 'apagado' };
const esCafe = c => c.est === 'cafeteria';
let SND = 'ambos'; try { SND = localStorage.getItem('pr-snd') || 'ambos'; } catch (e) {}
if (!SNDL[SND]) SND = 'ambos';
let AC = null;
function ctx() { try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; } catch (e) { return null; } }
function tono(f, t0, dur, tipo, vol) {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain(); o.type = tipo; o.frequency.value = f; o.connect(g); g.connect(c.destination);
  const t = c.currentTime + t0; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}
function vibra(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
function sonarCocina() { for (let i = 0; i < 3; i++) { tono(988, i * 0.75, 0.32, 'square', 0.9); tono(1319, i * 0.75 + 0.36, 0.32, 'square', 0.9); } vibra([300, 150, 300, 150, 300]); }
function sonarListo() { tono(784, 0, 0.35, 'sine', 0.8); tono(1047, 0.3, 0.35, 'sine', 0.8); tono(1319, 0.6, 0.7, 'sine', 0.8); vibra([200, 100, 200]); }
function toast(txt, cls) {
  const el = $('#toast'); if (!el) return;
  const d = document.createElement('div'); d.className = cls; d.innerHTML = esc(txt); el.appendChild(d);
  while (el.children.length > 4) el.removeChild(el.firstChild);
  setTimeout(() => { if (d.parentNode) d.remove(); }, 12000);
}
document.addEventListener('pointerdown', () => ctx());
document.addEventListener('click', e => { if (e.target.closest('#toast')) $('#toast').innerHTML = ''; });
/* Avisos: la administradora recibe TODO (comandas, listos, cafetería, pedidos, stock, reservas).
   Garzón: solo sus pedidos listos. Cocina: solo comandas nuevas. */
let EX = null; const ATR = new Set();
function avisar(prev) {
  const rol = rolesOn() ? S.rol : 'admin', adm = rol === 'admin' || rol === 'ingeniero';
  const modo = adm ? (SND === 'off' ? 'off' : 'ambos') : SND;
  const por = c => nm(c.mesa) + (c.garzon ? ' (' + c.garzon + ')' : '');
  const nuevos = D.comandas.filter(c => !prev.has(c.id) && c.estado === 'pendiente' && !esCafe(c));
  const cafes = D.comandas.filter(c => !prev.has(c.id) && esCafe(c));
  const listos = D.comandas.filter(c => c.estado === 'listo' && prev.get(c.id) !== 'listo' && !esCafe(c) && (rol !== 'garzon' || c.garzon === S.quien));
  if (nuevos.length && (adm || rol === 'cocina') && (modo === 'cocina' || modo === 'ambos')) { sonarCocina(); toast('NUEVA COMANDA · ' + nuevos.map(por).join(', '), 'tk-c'); }
  if (listos.length && (adm || rol === 'garzon') && (modo === 'salon' || modo === 'ambos')) { sonarListo(); toast('PEDIDO LISTO · ' + listos.map(por).join(', '), 'tk-l'); }
  const esQR = c => (c.note || '').startsWith('📱');
  const qrs = D.comandas.filter(c => !prev.has(c.id) && esQR(c) && !c.garzon);
  if (qrs.length && rol === 'garzon' && modo !== 'off') { sonarListo(); toast('PEDIDO QR · ' + [...new Set(qrs.map(c => nm(c.mesa)))].join(', '), 'tk-l'); }
  const tarde = D.comandas.filter(c => !c.cerrada && c.estado !== 'entregado' && c.estado !== 'listo' && !esCafe(c) && mins(c.t) >= 20 && !ATR.has(c.id));
  tarde.forEach(c => ATR.add(c.id));
  if (tarde.length && (adm || rol === 'cocina') && modo !== 'off' && modo !== 'salon') { sonarCocina(); toast('ATRASADA · ' + tarde.map(por).join(', '), 'tk-c'); }
  if (adm && modo !== 'off' && cafes.length) toast('CAFETERÍA · ' + cafes.map(por).join(', '), 'tk-l');
}
function avisarExtra() {
  const adm = esAdm(), ids = new Set((D.pedidos || []).map(p => p.id)), bajos = new Set(bajoStock().map(i => i.id));
  if (EX && EX.lid === D.id && adm && SND !== 'off') {
    const np = D.pedidos.filter(p => !EX.ped.has(p.id));
    if (np.length) { sonarListo(); toast('NUEVO ' + np.map(p => (p.tipo === 'delivery' ? 'DELIVERY' : 'PARA LLEVAR') + ' #' + (p.num - 1000) + ' · ' + p.cliente).join(', '), 'tk-c'); }
    const nb = bajoStock().filter(i => !EX.low.has(i.id));
    if (nb.length) toast('STOCK BAJO · ' + nb.map(i => i.n + ' (' + i.s + ')').join(', '), 'tk-c');
  }
  EX = { lid: D.id, ped: ids, low: bajos };
}
/* Anulaciones: la administradora recibe las solicitudes; el garzón, la respuesta; la cocina, el aviso de lo que ya no debe preparar */
let EXA = null;
function avisarAnu() {
  const an = D.anulaciones || [], rol = rolesOn() ? S.rol : 'admin', adm = rol === 'admin' || rol === 'ingeniero';
  if (EXA && EXA.lid === D.id) {
    const modo = adm ? (SND === 'off' ? 'off' : 'ambos') : SND;
    const cambio = an.filter(a => EXA.m.get(a.id) !== a.estado);
    const txt = a => nm(a.mesa) + ' · ' + a.cantidad + '× ' + a.item_n;
    const pend = cambio.filter(a => a.estado === 'pendiente'), apro = cambio.filter(a => a.estado === 'aprobada'), rech = cambio.filter(a => a.estado === 'rechazada');
    if (adm && modo !== 'off') {
      if (pend.length) { sonarListo(); toast('SOLICITUD DE ANULACIÓN · ' + pend.map(a => txt(a) + (a.garzon ? ' (' + a.garzon + ')' : '')).join(', '), 'tk-c'); }
      const o = apro.filter(a => a.resuelta_por !== (S.quien || 'Administradora'));
      if (o.length) toast('ANULACIÓN AUTORIZADA · ' + o.map(a => txt(a) + (a.resuelta_por ? ' (' + a.resuelta_por + ')' : '')).join(', '), 'tk-l');
    }
    if (rol === 'garzon' && modo !== 'off') {
      const ap = apro.filter(a => a.garzon === S.quien), rc = rech.filter(a => a.garzon === S.quien);
      if (ap.length) { sonarListo(); toast('ANULACIÓN APROBADA · ' + ap.map(txt).join(', '), 'tk-l'); }
      if (rc.length) { sonarListo(); toast('ANULACIÓN RECHAZADA · ' + rc.map(txt).join(', '), 'tk-c'); }
    }
    const coc = apro.filter(a => a.estacion === 'cocina');
    if (coc.length && rol === 'cocina' && (modo === 'cocina' || modo === 'ambos')) { sonarCocina(); toast('ANULADO · NO PREPARAR · ' + coc.map(a => txt(a) + (a.perdida ? ' (ya estaba en preparación)' : '')).join(', '), 'tk-c'); }
  }
  EXA = { lid: D.id, m: new Map(an.map(a => [a.id, a.estado])) };
}
const RESAL = new Set();
setInterval(() => {
  if (!S.user || !D || !esAdm() || SND === 'off') return;
  const now = new Date(), m0 = now.getHours() * 60 + now.getMinutes();
  (D.reservas || []).filter(r => r.estado === 'pendiente' && r.fecha === hoyIso()).forEach(r => {
    const m = +r.hora.slice(0, 2) * 60 + +r.hora.slice(3, 5);
    if (m - m0 <= 15 && m - m0 >= -5 && !RESAL.has(r.id)) { RESAL.add(r.id); sonarListo(); toast('RESERVA ' + r.hora + ' · ' + r.nombre + ' · ' + r.personas + ' pers.' + (r.mesa ? ' · ' + nm(r.mesa) : ''), 'tk-l'); }
  });
}, 30000);
let WL = null;
async function pantalla() { try { if (SND !== 'off' && 'wakeLock' in navigator && !WL && !document.hidden) { WL = await navigator.wakeLock.request('screen'); WL.addEventListener('release', () => { WL = null; }); } } catch (e) {} }
document.addEventListener('visibilitychange', () => { if (!document.hidden) pantalla(); });

async function llamarAdmin(body) {
  const { data } = await sb.auth.getSession();
  const r = await fetch(SB_URL + '/functions/v1/admin-resto', { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: 'Bearer ' + (data.session ? data.session.access_token : '') },
    body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || j.message || ('Error ' + r.status));
  return j;
}
async function adminCargar() {
  try { const j = await llamarAdmin({ action: 'list' }); S.av.locales = j.locales; S.av.err = ''; S.av.cargado = true; }
  catch (e) { S.av.err = e.message; S.av.cargado = true; }
  render();
}
const RAW = {};
/* cargar(parcial): si se indica un conjunto de tablas, solo esas se piden de nuevo a la base; el resto se toma de la última carga */
async function cargar(parcial) {
  if (parcial && !(D && RAW.mi)) parcial = null;
  const get = async (k, f) => { if (parcial && !parcial.has(k) && RAW[k]) return RAW[k]; const r = await f(); if (!r || !r.error) RAW[k] = r; return r; };
  S.admin = !!(S.user && S.user.app_metadata && S.user.app_metadata.role === 'protech_admin');
  if (S.admin && !S.av.cargado) adminCargar();
  const { data: mi, error: eMi } = parcial ? RAW.mi : await sb.from('resto_miembros').select('local_id').maybeSingle();
  if (!parcial && !eMi) RAW.mi = { data: mi, error: null };
  /* si la consulta falló (internet, token en renovación) NO se cierra la sesión: se conserva lo que ya está en pantalla y se reintenta */
  if (eMi) { if (!D) S.err = 'Sin conexión con el servidor. Reintentando…'; reintentarCarga(); return; }
  if (!mi && S.admin) { D = null; S.view = 'admin'; return; }
  if (!mi) { S.err = 'Tu cuenta aún no tiene un local asignado. Avisa a Protech.'; await sb.auth.signOut(); S.user = null; D = null; return; }
  const id = mi.local_id, desde = new Date(); desde.setHours(0, 0, 0, 0); desde.setDate(desde.getDate() - 1);
  const [loc, menu, com, cue, gar, tur, ped, res, coc, anu, gas, ins, imv, rec, prv, oco] = await Promise.all([
    get('loc', () => sb.from('resto_locales').select('*').eq('id', id).single()),
    get('menu', () => sb.from('resto_menu').select('*').eq('local_id', id).order('categoria').order('nombre')),
    get('com', () => sb.from('resto_comandas').select('*').eq('local_id', id).eq('cerrada', false)),
    get('cue', () => sb.from('resto_cuentas').select('*').eq('local_id', id).gte('created_at', desde.toISOString())),
    get('gar', () => sb.from('resto_garzones').select('*').eq('local_id', id).order('nombre')),
    get('tur', () => sb.from('resto_turnos').select('*').eq('local_id', id).is('cerrado_at', null).order('abierto_at', { ascending: false }).limit(1)),
    get('ped', () => sb.from('resto_pedidos').select('*').eq('local_id', id).eq('cerrado', false).order('num')),
    get('res', () => sb.from('resto_reservas').select('*').eq('local_id', id).gte('fecha', fechaIso(new Date())).order('fecha').order('hora')),
    get('coc', () => sb.from('resto_cocineras').select('*').eq('local_id', id).order('nombre')),
    get('anu', () => sb.from('resto_anulaciones').select('*').eq('local_id', id).gte('created_at', desde.toISOString()).order('created_at')),
    get('gas', () => sb.from('resto_gastos').select('*').eq('local_id', id).order('created_at', { ascending: false }).limit(300)),
    get('ins', () => sb.from('resto_insumos').select('*').eq('local_id', id).order('nombre')),
    get('imv', () => sb.from('resto_insumo_mov').select('*').eq('local_id', id).order('created_at', { ascending: false }).limit(150)),
    get('rec', () => sb.from('resto_recetas').select('*').eq('local_id', id)),
    get('prv', () => sb.from('resto_proveedores').select('*').eq('local_id', id).order('nombre')),
    get('oco', () => sb.from('resto_ordenes_compra').select('*').eq('local_id', id).order('created_at', { ascending: false }).limit(40))
  ]);
  if (loc.error) { if (!D) S.err = 'No se pudo cargar el local.'; reintentarCarga(); return; }
  const prev = D && D.id === id ? new Map(D.comandas.map(c => [c.id, c.estado])) : null;
  D = { id, insumos: ((ins && ins.data) || []).map(r => ({ id: r.id, n: r.nombre, u: r.unidad || 'un', s: +r.stock || 0, sm: +r.stock_min || 0, cu: r.costo_unit == null ? null : +r.costo_unit, on: r.activo !== false, v: r.vence || '' })), recetas: ((rec && rec.data) || []).map(r => ({ id: r.id, m: r.menu_id, i: r.insumo_id, q: +r.cantidad })), provs: ((prv && prv.data) || []).filter(r => r.activo !== false).map(r => ({ id: r.id, n: r.nombre, tel: r.telefono || '', mail: r.correo || '' })), ocs: ((oco && oco.data) || []).map(r => ({ id: r.id, pv: r.proveedor, est: r.estado, items: r.items || [], nota: r.nota || '', t: +new Date(r.created_at) })), insErr: !!(ins && ins.error), insmov: ((imv && imv.data) || []).map(r => ({ id: r.id, iid: r.insumo_id, d: +r.delta, mo: r.motivo, sd: r.stock_despues == null ? null : +r.stock_despues, ct: r.costo_total, td: r.tipo_doc || '', nd: r.numero_doc || '', pv: r.proveedor || '', nota: r.nota || '', caja: !!r.pagado_caja, por: r.registrado_por || '', t: +new Date(r.created_at) })), fondo: Math.max(0, +loc.data.fondo_caja || 0), gastos: ((gas && gas.data) || []).map(r => ({ id: r.id, turno_id: r.turno_id || null, tipo: r.tipo || 'Boleta', num: r.numero || '', prov: r.proveedor || '', det: r.detalle || '', m: +r.monto || 0, por: r.registrado_por || '', anul: !!r.anulado, anPor: r.anulado_por || '', anMot: r.anulado_motivo || '', pedPor: r.anul_pedida_por || '', pedMot: r.anul_pedida_motivo || '', mOrig: r.monto_original == null ? null : +r.monto_original, edPor: r.editado_por || '', edMot: r.editado_motivo || '', t: +new Date(r.created_at) })), turno: (tur.data && tur.data[0]) || null, pedidos: ped.data || [], reservas: res.data || [], name: loc.data.nombre, adminPin: loc.data.admin_pin || '', qr: !!loc.data.qr_activo, propinaPct: loc.data.propina_pct === undefined || loc.data.propina_pct === null ? 10 : +loc.data.propina_pct, mesas: loc.data.mesas, mesas2: loc.data.mesas2 || 0,
    garzones: (gar.data || []).map(r => ({ id: r.id, n: r.nombre, on: r.activo, pin: r.pin || '', cj: r.caja === undefined ? true : !!r.caja })),
    cocineras: ((coc && coc.data) || []).map(r => ({ id: r.id, n: r.nombre, on: r.activo, pin: r.pin || '' })),
    menu: (menu.data || []).map(r => ({ id: r.id, n: r.nombre, c: r.categoria, p: r.precio, on: r.activo, e: r.estacion === 'cafeteria' ? 'cafeteria' : 'cocina', s: r.stock == null ? null : r.stock, sm: r.stock_min || 0, cb: r.codigo || '', o: r.opciones || '' })).sort((x, y) => String(x.c || '').localeCompare(String(y.c || ''), 'es', { sensitivity: 'base' }) || String(x.n || '').localeCompare(String(y.n || ''), 'es', { sensitivity: 'base', numeric: true })),
    comandas: (com.data || []).map(r => ({ id: r.id, mesa: r.mesa, items: r.items, est: (r.items && r.items[0] && r.items[0].e === 'cafeteria') ? 'cafeteria' : 'cocina', note: r.nota || '', estado: r.estado, garzon: r.garzon || '', t: +new Date(r.created_at), cerrada: r.cerrada })),
    cuentas: (cue.data || []).map(r => ({ id: r.id, mesa: r.mesa, total: r.total, propina: r.propina, pe: r.propina_efec || 0, pq: !!r.propina_efec_caja, pt: r.propina_tarj || 0, metodo: r.metodo, garzon: r.garzon || '', items: r.items, turno_id: r.turno_id || null, cobrado_por: r.cobrado_por || '', desc: +r.descuento || 0, descM: r.desc_motivo || '', descA: r.desc_aut || '', mOrig: r.metodo_original || '', mPor: r.metodo_editado_por || '', mMot: r.metodo_editado_motivo || '', t: +new Date(r.created_at) })) };
  D.insumos.sort(porNombre); D.provs.sort(porNombre); /* inventario de producción y proveedores siempre de la A a la Z */
  outLoad(); outAplicar();
  D.anuOk =!!(anu && !anu.error); /* falso hasta que se ejecute la migración de anulaciones */
  D.anulaciones = D.anuOk ? (anu.data || []) : [];
  D.sesiones = [];
  if (D.turno) { const ss = await sb.from('resto_sesiones').select('*').eq('turno_id', D.turno.id).order('entrada'); D.sesiones = ss.data || []; await ensureSes(); }
  if (prev) avisar(prev);
  avisarExtra();
  avisarAnu();
}
/* ---------- Registro de quién está en caja ---------- */
async function ensureSes() {
  if (!rolesOn() || !D.turno || !S.rol || S.rol === 'cocina') return;
  if (S.ses && S.ses.turno === D.turno.id) return;
  const ya = D.sesiones.find(x => x.usuario === S.quien && !x.salida);
  if (ya) { S.ses = { id: ya.id, turno: D.turno.id }; return; }
  const r = await sb.from('resto_sesiones').insert({ local_id: D.id, turno_id: D.turno.id, usuario: S.quien, rol: S.rol }).select().single();
  if (r.data) { S.ses = { id: r.data.id, turno: D.turno.id }; D.sesiones.push(r.data); }
}
async function endSes() {
  const x = S.ses; S.ses = null;
  if (x) { try { await sb.from('resto_sesiones').update({ salida: new Date().toISOString() }).eq('id', x.id); } catch (e) {} }
}
let rt = null, tmr = null, tReint = null;
const PEND = new Set();
function reintentarCarga() {
  clearTimeout(tReint);
  tReint = setTimeout(async () => { if (!S.user) return; try { await cargar(); } catch (e) {} render(); }, 5000);
}
/* Al volver a la app (celular que la había dormido, PC que estuvo suspendido o internet que volvió) se renueva la sesión y los datos sin pedir ingreso */
async function reconectar() {
  if (S.setpass) return;
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) { const r = await sb.auth.refreshSession(); if (r.data && r.data.session) data.session = r.data.session; }
    if (!data.session) return;
    S.user = data.session.user;
    await cargar();
    if (rt) { sb.removeChannel(rt); rt = null; }
    suscribir(); render();
  } catch (e) { reintentarCarga(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) reconectar(); });
window.addEventListener('online', () => { if (S.user) reconectar(); });
setInterval(() => { if (S.user && !document.hidden) sb.auth.getSession(); }, 10 * 60 * 1000);
function suscribir() {
  if (rt || !D) return;
  const TK = { resto_comandas: 'com', resto_menu: 'menu', resto_locales: 'loc', resto_cuentas: 'cue', resto_turnos: 'tur', resto_pedidos: 'ped', resto_reservas: 'res', resto_anulaciones: 'anu', resto_sesiones: 'ses', resto_gastos: 'gas', resto_insumos: 'ins', resto_insumo_mov: 'imv', resto_recetas: 'rec', resto_proveedores: 'prv', resto_ordenes_compra: 'oco' };
  const refresca = t => { if (t && TK[t]) PEND.add(TK[t]); else PEND.add('*'); clearTimeout(tmr); tmr = setTimeout(async () => { if (!S.user) return; const p = PEND.has('*') ? null : new Set(PEND); PEND.clear(); await cargar(p); render(); }, 300); };
  rt = sb.channel('resto-' + D.id);
  ['resto_comandas', 'resto_menu', 'resto_locales', 'resto_cuentas', 'resto_turnos', 'resto_pedidos', 'resto_reservas', 'resto_sesiones', 'resto_anulaciones', 'resto_gastos', 'resto_insumos', 'resto_insumo_mov', 'resto_recetas', 'resto_proveedores', 'resto_ordenes_compra'].forEach(t => rt.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => refresca(t)));
  rt.subscribe();
}
const _h = location.hash || '';
if (/type=(invite|recovery)/.test(_h)) S.setpass = true;
sb.auth.onAuthStateChange(ev => {
  if (ev === 'PASSWORD_RECOVERY') { S.setpass = true; render(); }
  /* si Supabase pierde la sesión sin que nadie pulse "Salir", se intenta recuperar antes de mostrar el ingreso */
  if (ev === 'SIGNED_OUT' && S.user && !S.saliendo) setTimeout(() => { if (!S.saliendo) reconectar(); }, 1500);
});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
async function inicio() {
  const { data } = await sb.auth.getSession();
  S.user = data.session ? data.session.user : null;
  if (S.user && !S.setpass) { await cargar(); suscribir(); }
  S.loading = false; render(); pantalla();
}

/* ---------- Vistas ---------- */
function loginHTML() {
  if (S.loading) return `<div class="login"><div class="card"><div class="mut">Cargando…</div></div></div>`;
  if (S.setpass) return `<div class="login"><div class="card">
    <div><b style="font-size:1.4rem">PROTECH <span style="color:var(--brand)">RESTO</span></b><div class="mut">Crea tu clave para entrar</div></div>
    <label class="mut">Clave nueva (mínimo 8 caracteres)<input id="np1" type="password" autocomplete="new-password"></label>
    <label class="mut">Repite la clave<input id="np2" type="password" autocomplete="new-password"></label>
    ${S.err ? `<div style="color:var(--bad);font-size:.9rem">${esc(S.err)}</div>` : ''}
    <button class="btn" data-act="guardarclave" ${S.busy ? 'disabled' : ''}>Guardar clave y entrar</button></div></div>`;
  if (S.olvide) return `<div class="login"><div class="card">
    <div><b style="font-size:1.4rem">PROTECH <span style="color:var(--brand)">RESTO</span></b><div class="mut">Crear o recuperar mi clave</div></div>
    <label class="mut">Correo del local<input id="rmail" type="email" autocomplete="username" placeholder="local@correo.cl"></label>
    ${S.err ? `<div style="color:var(--bad);font-size:.9rem">${esc(S.err)}</div>` : ''}
    ${S.ok ? `<div style="color:var(--ok);font-size:.9rem">${esc(S.ok)}</div>` : ''}
    <button class="btn" data-act="enviarlink" ${S.busy ? 'disabled' : ''}>Enviarme un enlace al correo</button>
    <button class="btn-line" data-act="volverlogin">Volver</button></div></div>`;
  return `<div class="login"><div class="card">
    <div><b style="font-size:1.4rem">PROTECH <span style="color:var(--brand)">RESTO</span></b><div class="mut">Pedidos y comandas para restaurantes y cafeterías</div></div>
    <label class="mut">Correo del local<input id="lmail" type="email" autocomplete="username" placeholder="local@correo.cl"></label>
    <label class="mut">Clave<input id="lpass" type="password" autocomplete="current-password" placeholder="••••••••"></label>
    ${S.err ? `<div style="color:var(--bad);font-size:.9rem">${esc(S.err)}</div>` : ''}
    <button class="btn" data-act="login" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Entrando…' : 'Entrar'}</button>
    <button class="btn-line" data-act="olvide">Primera vez o olvidé mi clave</button>
    <div class="hint">¿No tienes cuenta? Pídela a Protech: <a href="https://wa.me/56939473588" target="_blank" rel="noopener">WhatsApp +56 9 3947 3588</a>. Cada local ve solo sus propios datos.</div>
  </div></div>`;
}
function shell(inner) {
  const todas = [['mesas', 'Mesas'], ['cocina', 'Cocina'], ['cafe', 'Cafetería'], ['resv', 'Reservas'], ['turno', 'Caja'], ['caja', 'Ventas'], ['resumen', 'Resumen'], ['inv', 'Inventario' + (bajoStock().length ? ' ⚠' + bajoStock().length : '')], ['prod', 'Inventario de producción' + (bajoIns().length ? ' ⚠' + bajoIns().length : '')], ['abast', 'Compras y recetas' + (vencen().length ? ' ⚠' : '')], ['garz', 'Garzones'], ['coms', 'Comandas'], ['carta', 'Carta y mesas'], ['bit', 'Registro de cambios']];
  const tabs = todas.filter(t => misTabs().includes(t[0]));
  if (S.admin) tabs.push(['admin', 'Admin Protech']);
  return `<header><div><b>${esc(L().name)}</b><small>Protech Resto</small></div>
    <nav>${tabs.map(([k, n]) => `<button class="${S.view === k ? 'on' : ''}" data-act="tab" data-v="${k}">${n}</button>`).join('')}</nav>
    <button class="btn-line" style="padding:6px 12px" data-act="sonido">Sonido: ${SNDL[SND]}${SND !== 'off' && !(AC && AC.state === 'running') ? ' (toca para activar)' : ''}</button>
    ${rolesOn() ? `<button class="btn-line" style="padding:6px 12px" data-act="cambiar">${esc(S.rol === 'ingeniero' ? 'Carlos Oporto · Ingeniero' : S.rol === 'admin' ? 'Administradora' : S.rol === 'cocina' ? (S.quien && S.quien !== 'Cocina' ? 'Cocina · ' + S.quien : 'Cocina') : S.quien)} · cambiar</button>` : ''}
    <button class="btn-line" style="padding:6px 12px" data-act="logout">Salir</button></header><main>${S.rol === 'cocina' && SND !== 'off' && !(AC && AC.state === 'running') ? '<button class="btn" style="width:100%;margin-bottom:12px;padding:14px;font-size:1.1rem" data-act="activarsonido">🔔 Toca aquí para activar el sonido de las comandas</button>' : ''}${inner}</main>`;
}
function mesasHTML() {
  if (S.mesa !== null && !puedeVerMesa(S.mesa)) S.mesa = null;
  if (S.mesa !== null) return mesaDetalle();
  const l = L(); let g = '', g2 = '';
  const listos = l.comandas.filter(c => !c.cerrada && c.estado === 'listo');
  const avisoListos = listos.length ? `<div class="card" style="margin-bottom:12px;border:2px solid var(--ok)"><b>Listos para llevar a la mesa</b>${listos.map(c => `<div class="row"><div><b>${nm(c.mesa)}</b> · ${c.items.map(i => i.q + '× ' + esc(i.n)).join(', ')}</div><button class="btn-ok" data-act="avanzar" data-id="${c.id}" data-to="entregado">Entregado en mesa</button></div>`).join('')}</div>` : '';
  const tarjeta = n => {
    const a = abiertas(n), lis = a.some(c => c.estado === 'listo');
    const rv = !a.length && resDe(n);
    return `<button class="mesa ${lis ? 'lis' : a.length ? 'ocu' : ''}" ${rv ? 'style="border-color:var(--brand);background:var(--soft)"' : ''} data-act="mesa" data-n="${n}"><b>${n > 100 ? n - 100 : n}</b>
      <span>${lis ? 'Pedido listo' : a.length ? 'Ocupada · ' + money(totalMesa(n)) + (a.find(c => c.garzon) ? '<br><b>' + esc(a.find(c => c.garzon).garzon) + '</b>' : '') : rv ? 'Reservada ' + esc(rv.hora) + ' · ' + esc(rv.nombre) : 'Libre'}</span></button>`;
  };
  for (let n = 1; n <= l.mesas; n++) g += tarjeta(n);
  for (let k = 1; k <= l.mesas2; k++) g2 += tarjeta(100 + k);
  if (S.mos) return mostradorHTML();
  const fnp = S.np ? `<div style="display:grid;gap:8px;margin-top:10px"><b>${S.np.tipo === 'delivery' ? 'Nuevo delivery' : 'Nuevo pedido para llevar'}</b>
    <input id="np-c" data-keep placeholder="Nombre del cliente" value="${fv('np-c')}">
    <input id="np-t" data-keep type="tel" inputmode="tel" placeholder="Teléfono" value="${fv('np-t')}">
    ${S.np.tipo === 'delivery' ? `<input id="np-d" data-keep placeholder="Dirección de entrega" value="${fv('np-d')}">` : ''}
    <div style="display:flex;gap:8px"><button class="btn" data-act="crearped">Crear y tomar pedido</button><button class="btn-line" data-act="cancelnp">Cancelar</button></div></div>` : '';
  const cartaPed = `<div class="card" style="margin-bottom:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="flex:1">Mostrador, para llevar y delivery</b>${puedeCobrar() ? '<button class="btn-ok" data-act="mostrador">+ Venta mostrador</button>' : '<span class="mut">Mostrador: solo con autorización</span>'}<button class="btn" data-act="nuevoped" data-t="llevar">+ Para llevar</button><button class="btn" data-act="nuevoped" data-t="delivery">+ Delivery</button></div>${fnp}
    ${(l.pedidos || []).map(p => { const a = abiertas(p.num), lis = a.some(c => c.estado === 'listo'); return `<div class="row"><div>${p.tipo === 'delivery' ? '🛵' : '🥡'} <b>#${p.num - 1000}</b> ${esc(p.cliente || '')}<div class="mut">${a.length ? (lis ? 'Listo · ' : 'En preparación · ') + money(totalMesa(p.num)) : 'Sin pedido enviado'}${p.direccion ? ' · ' + esc(p.direccion) : ''}</div></div><button class="${lis ? 'btn-ok' : 'btn-line'}" data-act="mesa" data-n="${p.num}">Abrir</button></div>`; }).join('')}</div>`;
  const ocup = []; for (let n = 1; n <= l.mesas; n++) ocup.push(n); for (let k = 1; k <= l.mesas2; k++) ocup.push(100 + k);
  const oc = ocup.filter(n => abiertas(n).length), enMesas = oc.reduce((a, n) => a + totalMesa(n), 0);
  const resumen = `<p class="mut" style="margin-bottom:10px"><b>${oc.length}</b> de ${ocup.length} mesas ocupadas · por cobrar en mesas <b>${money(enMesas)}</b></p>`;
  return `<h2>Mesas</h2>${resumen}${pushCardHTML()}${anuPendientesHTML()}${avisoListos}${cartaPed}${l.mesas2 ? '<div class="piso">Piso 1</div>' : ''}<div class="grid">${g}</div>${l.mesas2 ? `<div class="piso">Piso 2</div><div class="grid">${g2}</div>` : ''}<p class="mut" style="margin-top:14px">Toca una mesa para tomar un pedido. Verde = pedido listo para llevar.</p>`;
}
const mesasAbiertas = () => [...new Set(L().comandas.filter(c => !c.cerrada && c.mesa > 0).map(c => c.mesa))].sort((a, b) => a - b);
function porCobrarHTML() {
  const ms = mesasAbiertas();
  return `<div class="card" style="margin-bottom:12px"><b>Mesas por cobrar</b><p class="mut" style="margin:4px 0">Cuando un cliente termina y viene a pagar a la caja, cóbralo aquí.</p>${ms.map(n => { const a = abiertas(n), g = (a.find(c => c.garzon) || {}).garzon; return `<div class="row"><div><b>${nm(n)}</b>${g ? ' <small class="mut">' + esc(g) + '</small>' : ''}<div class="mut">${a.map(c => c.items.map(i => (i.q - (i.pg || 0)) + '× ' + esc(i.n)).join(', ')).join(' · ')}</div></div><div style="display:flex;gap:8px;align-items:center"><b>${money(totalMesa(n))}</b>${puedeCobrarEsta(n) ? `<button class="btn-ok" data-act="cobrarmesa" data-n="${n}">Cobrar</button>` : '<span class="mut">' + (puedeCobrarMesa() ? 'Mesa de ' + esc(duenoMesa(n)) : 'Cobra en caja') + '</span>'}</div></div>`; }).join('') || '<p class="mut" style="margin-top:8px">No hay mesas con consumo pendiente.</p>'}</div>`;
}
const norm = t => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
/* Lupita de búsqueda rápida para las listas de inventario y carta: filtra mientras se escribe, sin tildes ni mayúsculas. */
const buscaHTML = (id, ph) => `<input id="${id}" data-keep type="search" autocomplete="off" placeholder="🔍 ${ph}" style="width:100%;margin:0 0 8px" value="${fv(id)}">`;
const filtra = (arr, id) => { const q = norm(S.f[id]); if (!q) return arr; const ws = q.split(/\s+/); return arr.filter(i => { const t = norm(i.n + ' ' + (i.c || '')); return ws.every(w => t.includes(w)); }); };
const BUSQ = ['q-inv', 'q-carta', 'q-prod'];
function busMos() {
  const q = norm(S.f['bus-mos']); if (!q) return [];
  const ws = q.split(/\s+/);
  const ok = i => { const t = norm(i.n + ' ' + i.c), pl = t.split(/\s+/); return ws.every(w => pl.some(p => p.startsWith(w)) || (w.length >= 3 && t.includes(w))); };
  return L().menu.filter(i => i.on && ok(i)).sort((a, b) => a.n.localeCompare(b.n, 'es', { sensitivity: 'base', numeric: true })).slice(0, 15);
}
function addMos(id) {
  const it = L().menu.find(x => x.id === id); if (!it) return;
  let q = Math.round(+S.f['bq-' + id]); if (!(q >= 1)) q = 1;
  if (it.s != null) { const libre = it.s - (S.cart[id] || 0); if (libre <= 0) { toast('Sin stock suficiente de ' + it.n, 'tk-c'); return; } if (q > libre) { q = libre; toast('Solo quedan ' + it.s + ' de ' + it.n, 'tk-c'); } }
  S.cart[id] = (S.cart[id] || 0) + q;
  delete S.f['bq-' + id]; delete S.f['bus-mos'];
}
function buscadorHTML() {
  return `<input id="bus-mos" data-keep autocomplete="off" placeholder="🔍 Buscar producto: escribe el inicio (ej. tor, ca…) y Enter agrega el primero" style="width:100%;margin:0 0 8px" value="${fv('bus-mos')}">
    ${S.f['bus-mos'] ? `<div style="border:2px solid var(--warn);border-radius:10px;padding:4px 10px;margin-bottom:10px">${busMos().map(i => `<div class="row"><div>${esc(i.n)}<div class="mut">${esc(i.c)} · ${money(i.p)}${i.s != null ? (i.s <= 0 ? ' · <b style="color:var(--bad)">Sin stock</b>' : ' · quedan ' + i.s) : ''}</div></div><div style="display:flex;gap:6px;align-items:center"><input id="bq-${i.id}" data-keep type="number" inputmode="numeric" min="1" title="Cantidad" aria-label="Cantidad" style="width:64px;text-align:center" value="${S.f['bq-' + i.id] === undefined ? 1 : fv('bq-' + i.id)}"><button class="btn-ok" data-act="mosadd" data-id="${i.id}" ${i.s != null && (S.cart[i.id] || 0) >= i.s ? 'disabled style="opacity:.4"' : ''}>+ Agregar</button></div></div>`).join('') || '<p class="mut" style="margin:8px 0">Sin resultados.</p>'}</div>` : ''}`;
}
function mostradorHTML() {
  const l = L(), cats = [...new Set(l.menu.filter(i => i.on).map(i => i.c))];
  const carta = cats.map(c => `<div class="cat">${esc(c)}</div>` + l.menu.filter(i => i.on && i.c === c).map(i => `
    <div class="row"><div>${esc(i.n)}<div class="mut">${money(i.p)}${i.s != null ? (i.s <= 0 ? ' · <b style="color:var(--bad)">Sin stock</b>' : ' · quedan ' + i.s) : ''}</div></div>
    <div class="q"><button data-act="dec" data-id="${i.id}">−</button><span>${S.cart[i.id] || 0}</span><button data-act="inc" data-id="${i.id}" ${i.s != null && (S.cart[i.id] || 0) >= i.s ? 'disabled style="opacity:.4"' : ''}>+</button></div></div>`).join('')).join('');
  const sel = l.menu.filter(i => S.cart[i.id]), sub = sel.reduce((a, i) => a + i.p * S.cart[i.id], 0);
  return `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><button class="btn-line" data-act="mosvolver">← Mesas</button><h2 style="margin:0">Venta mostrador</h2></div>${porCobrarHTML()}
  <div class="cols"><div class="card"><b>Productos</b>
    <input id="scan-mos" data-keep autocomplete="off" placeholder="Escanear código de barras…" style="width:100%;margin:8px 0" value="${fv('scan-mos')}">
    ${buscadorHTML()}
    ${carta || '<p class="mut">La carta está vacía.</p>'}</div>
  <div><div class="card"><b>Venta</b>${sel.map(i => `<div class="row"><span>${S.cart[i.id]}× ${esc(i.n)}</span><b>${money(i.p * S.cart[i.id])}</b></div>`).join('') || '<p class="mut" style="margin:8px 0">Agrega productos.</p>'}
    ${sub > 0 ? `<input id="nota" placeholder="Observación para cocina (sin mayonesa, sin cebolla, etc.)" value="${esc(S.note)}" style="margin-top:8px">${chipsOpc(sel)}` : ''}
    ${sub > 0 ? camposPago(sub) : ''}
    ${!cajaAbierta() ? '<p class="mut" style="margin-top:8px;color:var(--bad)">La caja está cerrada. La administradora debe abrirla para cobrar.</p>' : ''}
    <button class="btn-ok" style="width:100%;margin-top:10px" data-act="mospagar" ${sub > 0 && cajaAbierta() ? '' : 'disabled'}>Cobrar ${sub > 0 ? money(sub) : ''}</button></div></div></div>`;
}
/* ---------- Propina y descuentos ----------
   La propina sugerida es un porcentaje configurable por el local. Los garzones pueden quitarla o cambiarla libremente;
   los descuentos y cortesías los da la administradora o, en el equipo de un garzón, con el PIN de la administradora (la base de datos lo exige). */
const pctProp = () => { const p = D && D.propinaPct; return p === undefined || p === null || isNaN(+p) ? 10 : +p; };
const pctEfect = () => S.propPct != null ? S.propPct : pctProp();
const descMonto = base => { const d = S.desc; if (!d) return 0; const v = d.t === 'cortesia' ? base : d.t === 'pct' ? Math.round(base * Math.min(100, Math.max(0, d.v)) / 100) : Math.round(d.v); return Math.max(0, Math.min(base, v)); };
/* Propina en efectivo: por defecto queda en la caja (el cliente deja el vuelto) y se le paga al garzón al cerrar. Si se la dieron directo en la mano, se marca aparte. */
const peEnCaja = () => S.peDonde !== 'mano';
const peMonto = () => Math.max(0, Math.round(+S.pe || 0));
const peCampos = pe => pe ? { propina_efec: pe, ...(peEnCaja() ? { propina_efec_caja: true } : {}) } : {};
const calcPago = base => { const desc = descMonto(base), neto = base - desc, prop = S.propina ? Math.round(neto * pctEfect() / 100) : 0, ptj = S.metodo === 'Tarjeta' ? Math.max(0, Math.round(+S.pt || 0)) : 0; const pcj = S.metodo === 'Efectivo' && peEnCaja() ? peMonto() : 0; return { desc, neto, prop, ptj, pcj, total: neto + prop + ptj + pcj }; };
const descCampos = base => { const x = descMonto(base); return x > 0 ? { descuento: x, desc_motivo: S.desc.motivo || '', desc_aut: S.desc.aut || '' } : {}; };
const resetCobro = () => { S.pe = ''; S.peDonde = null; S.pt = ''; S.rc = ''; S.desc = null; S.aut = null; S.propPct = null; S.autForm = null; S.autPend = null; S.autErr = ''; delete S.f['aut-pin']; delete S.f['d-val']; delete S.f['d-mot']; };
const conAut = async f => { const keep = RTOK; if (S.aut && S.aut.tok) RTOK = S.aut.tok; try { return await f(); } finally { RTOK = keep; } };
const DESC_MOTIVOS = ['Cortesía de la casa', 'Cliente frecuente', 'Error o demora en el servicio', 'Reclamo del cliente', 'Cumpleaños', 'Otro'];
function autFormHTML() {
  const f = S.autForm; if (!f) return '';
  const pin = !esAdm() ? `<label class="mut">PIN de la administradora<input id="aut-pin" data-keep type="password" inputmode="numeric" autocomplete="off" placeholder="••••" value="${fv('aut-pin')}"></label>` : '';
  const cuerpo = f === 'desc' ? `<label class="mut">Tipo<select id="d-tipo" data-keep><option value="pct" ${S.f['d-tipo'] !== 'monto' && S.f['d-tipo'] !== 'cortesia' ? 'selected' : ''}>Porcentaje (%)</option><option value="monto" ${S.f['d-tipo'] === 'monto' ? 'selected' : ''}>Monto ($)</option><option value="cortesia" ${S.f['d-tipo'] === 'cortesia' ? 'selected' : ''}>Cortesía (se invita todo)</option></select></label>
      ${S.f['d-tipo'] === 'cortesia' ? '' : `<label class="mut">Valor<input id="d-val" data-keep type="number" inputmode="numeric" min="1" placeholder="${S.f['d-tipo'] === 'monto' ? '$' : '%'}" value="${fv('d-val')}"></label>`}
      <label class="mut">Motivo<select id="d-mot" data-keep>${DESC_MOTIVOS.map(m => `<option ${S.f['d-mot'] === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>`
    : `<p class="mut" style="margin:0">Quitar o cambiar la propina necesita autorización de la administradora.</p>`;
  return `<div class="card" style="margin-top:10px;background:#fffbeb;display:grid;gap:8px"><b>${f === 'desc' ? 'Descuento o cortesía' : 'Cambiar la propina'}</b>${cuerpo}${pin}
    ${S.autErr ? `<div style="color:var(--bad);font-size:.9rem">${esc(S.autErr)}</div>` : ''}
    <div style="display:flex;gap:8px"><button class="btn" style="flex:1" data-act="autok">Autorizar</button><button class="btn-line" data-act="autno">Cancelar</button></div></div>`;
}
function camposPago(base) {
  const cp = calcPago(base), pct = pctEfect();
  const dl = S.desc ? `<div class="row"><span>Descuento ${S.desc.t === 'cortesia' ? '(cortesía)' : S.desc.t === 'pct' ? S.desc.v + '%' : ''}<div class="mut">${esc(S.desc.motivo)} · autorizó ${esc(S.desc.aut)}</div></span><span style="display:flex;gap:8px;align-items:center"><b style="color:var(--bad)">−${money(cp.desc)}</b><button class="btn-line" style="padding:4px 10px" data-act="descquitar">Quitar</button></span></div>`
    : `<div class="row"><span class="mut">¿Descuento o cortesía?</span><button class="btn-line" style="padding:6px 12px" data-act="descabrir">Aplicar descuento</button></div>`;
  return `${dl}${autFormHTML()}
    <label class="row" style="cursor:pointer"><span>Propina sugerida ${pct}%</span><input type="checkbox" style="width:auto" data-act="propina" ${S.propina ? 'checked' : ''}></label>
    ${S.propina ? `<label class="mut" style="display:block;margin-top:4px">Porcentaje de propina<select id="proppct">${[0, 5, 10, 15, 20, 25].concat([pctProp()]).filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y).map(v => `<option value="${v}" ${v === pct ? 'selected' : ''}>${v}%${v === pctProp() ? ' (sugerida)' : ''}</option>`).join('')}</select></label>` : ''}
    <label class="mut" style="display:block;margin-top:8px">Forma de pago<select id="metodo"><option ${S.metodo === 'Efectivo' ? 'selected' : ''}>Efectivo</option><option ${S.metodo === 'Tarjeta' ? 'selected' : ''}>Tarjeta</option><option ${S.metodo === 'Transferencia' ? 'selected' : ''}>Transferencia</option></select></label>
    ${S.metodo === 'Tarjeta' ? `<label class="mut" style="display:block;margin-top:8px">Propina o recargo adicional en la tarjeta (se suma al total)<input id="ptarj" type="number" inputmode="numeric" min="0" placeholder="0" value="${esc(S.pt)}"></label>` : ''}
    <label class="mut" style="display:block;margin-top:8px">Propina en efectivo (no se suma a la cuenta)<input id="pefec" type="number" inputmode="numeric" min="0" placeholder="0" value="${esc(S.pe)}"></label>
    <label class="mut" style="display:block;margin-top:8px">¿Dónde quedó la propina en efectivo?<select id="pedonde"><option value="caja" ${peEnCaja() ? 'selected' : ''}>Quedó en la caja (del vuelto): se le paga al cerrar</option><option value="mano" ${peEnCaja() ? '' : 'selected'}>Se la dieron directo al garzón</option></select></label>
    <div class="total"><span>Total a pagar</span><span id="totpagar" data-base="${base}">${money(cp.total)}</span></div>
    ${pagoDetalleHTML(cp.total)}`;
}
/* Detalle del pago según la forma elegida: efectivo (con cuánto paga y vuelto), tarjeta o transferencia */
function pagoDetalleHTML(total) {
  if (S.metodo === 'Efectivo') {
    const billetes = [2000, 5000, 10000, 20000].filter(b => b >= total || b === 20000);
    return `<div class="card" style="margin-top:10px;background:#f0fdf4;display:grid;gap:8px"><b>Pago en efectivo</b>
      <label class="mut">Efectivo recibido del cliente<input id="recib" type="number" inputmode="numeric" min="0" placeholder="¿Con cuánto paga?" value="${esc(S.rc)}"></label>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn-line" data-act="rec" data-v="${total}">Justo</button>${billetes.map(b => `<button class="btn-line" data-act="rec" data-v="${b}">${money(b)}</button>`).join('')}</div>
      <div class="total" style="margin:0"><span>Vuelto a entregar</span><span id="vuelto" data-total="${total}">—</span></div></div>`;
  }
  if (S.metodo === 'Tarjeta') return `<div class="card" style="margin-top:10px;background:#eff6ff"><b>Pago con tarjeta</b><div class="mut" style="margin-top:4px">Cobra <b>${money(total)}</b> en el terminal de tarjeta y confirma cuando salga aprobado.</div></div>`;
  return `<div class="card" style="margin-top:10px;background:#faf5ff"><b>Pago por transferencia</b><div class="mut" style="margin-top:4px">Confirma que la transferencia de <b>${money(total)}</b> ya llegó a la cuenta antes de cobrar.</div></div>`;
}
const totalPago = base => calcPago(base).total;
const recibidoMal = base => S.metodo === 'Efectivo' && S.rc !== '' && S.rc !== undefined && Math.round(+S.rc) < totalPago(base);
function actualizaVuelto() {
  const v = $('#vuelto'); if (!v) return;
  if (S.rc === '' || S.rc === undefined) { v.textContent = '—'; v.style.color = ''; return; }
  const d = Math.round(+S.rc) - (+v.dataset.total);
  v.textContent = d >= 0 ? money(d) : 'Faltan ' + money(-d); v.style.color = d >= 0 ? 'var(--ok)' : 'var(--bad)';
}
function baseCobro(a) {
  if (a === 'pagar') return totalMesa(S.mesa);
  if (a === 'mospagar') return L().menu.filter(i => S.cart[i.id]).reduce((s, i) => s + i.p * S.cart[i.id], 0);
  return abiertas(S.mesa).reduce((s, c) => s + c.items.reduce((t, i, ix) => t + Math.min(S.sel[c.id + ':' + ix] || 0, i.q - (i.pg || 0)) * i.p, 0), 0);
}
/* ---------- Anulación de productos ya enviados ----------
   El garzón solicita; la administradora aprueba (en su pantalla o con su PIN en el equipo del garzón).
   Cafetería sale directo de la mesa: se quita sin autorización, pero queda registrado. */
const ANU_MOTIVOS = ['El cliente cambió de opinión', 'Error al anotar el pedido', 'Demora en la entrega', 'Producto no disponible', 'Otro'];
const anuPend = (cid, n) => ((D && D.anulaciones) || []).find(a => a.comanda_id === cid && a.item_n === n && a.estado === 'pendiente');
const anuLibre = i => i.q - (i.pg || 0);
const anuDirecto = c => esAdm() || esCafe(c);
const ahoraIso = () => new Date().toISOString();
async function anuAplicar(a, por) {
  const cierra = async (estado, quien) => fallo(await sb.from('resto_anulaciones').update({ estado, resuelta_por: quien, resuelta_at: ahoraIso() }).eq('id', a.id));
  const c = D.comandas.find(x => x.id === a.comanda_id && !x.cerrada), it = c && c.items.find(i => i.n === a.item_n);
  const cant = it ? Math.min(a.cantidad, anuLibre(it)) : 0;
  if (!c || !it || cant <= 0) { alert('Ese producto ya no está en una mesa abierta (se cobró o ya se quitó). La solicitud se cierra.'); await cierra('rechazada', 'Sistema'); return false; }
  const items = c.items.map(i => i === it ? { ...i, q: i.q - cant } : i).filter(i => i.q > 0);
  const lista = !items.length || (items.every(i => (i.pg || 0) >= i.q) && c.estado === 'entregado');
  if (fallo(await sb.from('resto_comandas').update({ items, ...(lista ? { cerrada: true } : {}) }).eq('id', c.id))) return false;
  /* si cocina todavía no lo tocaba, el producto vuelve al stock; si ya lo preparaba, queda como pérdida */
  const perdida = c.estado !== 'pendiente' && !esCafe(c);
  if (!perdida) { const m = D.menu.find(x => x.n === a.item_n && x.s != null); if (m) await sb.rpc('resto_stock_mover', { p_menu: m.id, p_delta: cant, p_motivo: 'anulación', p_por: por, p_log: true }); }
  fallo(await sb.from('resto_anulaciones').update({ estado: 'aprobada', cantidad: cant, perdida, resuelta_por: por, resuelta_at: ahoraIso() }).eq('id', a.id));
  return true;
}
function anuItemHTML(c, i, ix) {
  const pen = anuPend(c.id, i.n);
  const pg = i.pg ? ' <small class="mut">(' + (i.pg >= i.q ? 'pagado' : i.pg + ' pagado') + ')</small>' : '';
  const mini = 'padding:2px 8px;font-size:.8rem';
  let acc = '';
  if (D.anuOk && pen) {
    acc = ` <span class="pill" style="background:#fef3c7;color:#92400e">anulación pendiente (${pen.cantidad})</span>` + (esAdm()
      ? ` <button class="btn-ok" style="${mini}" data-act="anuaprobar" data-id="${pen.id}">Aprobar</button> <button class="btn-bad" style="${mini}" data-act="anurech" data-id="${pen.id}">Rechazar</button>`
      : ` <button class="btn-line" style="${mini}" data-act="anupin" data-id="${pen.id}">Autorizar con PIN</button>`);
  } else if (D.anuOk && anuLibre(i) > 0 && !S.mos) acc = ` <button class="btn-line" style="${mini}" data-act="anuabrir" data-c="${c.id}" data-i="${ix}">${anuDirecto(c) ? 'Quitar' : 'Solicitar anulación'}</button>`;
  return `<div style="margin-top:4px">${i.q}× ${esc(i.n)}${pg}${acc}</div>`;
}
function anuFormHTML(n) {
  let h = '';
  if (S.an) {
    const f = S.an, c = abiertas(n).find(x => x.id === f.c), it = c && c.items.find(x => x.n === f.n);
    if (!c || !it) S.an = null;
    else {
      const max = anuLibre(it), directo = anuDirecto(c);
      h += `<div class="card" style="margin:8px 0;border:2px solid var(--warn);display:grid;gap:8px"><b>${directo ? 'Quitar de la cuenta' : 'Solicitar anulación de'} «${esc(it.n)}»</b>
        <label class="mut">Cantidad a anular (hay ${max})<input id="anu-q" data-keep type="number" inputmode="numeric" min="1" max="${max}" value="${S.f['anu-q'] === undefined ? 1 : fv('anu-q')}"></label>
        <label class="mut">Motivo<select id="anu-m" data-keep>${ANU_MOTIVOS.map(m => `<option ${S.f['anu-m'] === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        <input id="anu-t" data-keep placeholder="Detalle (opcional)" value="${fv('anu-t')}">
        ${c.estado !== 'pendiente' && !esCafe(c) ? '<p class="mut" style="color:var(--bad)">Cocina ya empezó o terminó este pedido: quedará registrado como pérdida.</p>' : ''}
        ${directo ? '' : '<p class="mut">La administradora recibe la solicitud y debe aprobarla. Mientras tanto, el producto sigue en la cuenta.</p>'}
        <div style="display:flex;gap:8px"><button class="btn" data-act="anuok">${directo ? 'Quitar ahora' : 'Enviar solicitud'}</button><button class="btn-line" data-act="anucancel">Cancelar</button></div></div>`;
    }
  }
  if (S.anp) {
    const a = (D.anulaciones || []).find(x => x.id === S.anp && x.estado === 'pendiente');
    if (!a) S.anp = null;
    else h += `<div class="card" style="margin:8px 0;border:2px solid var(--warn);display:grid;gap:8px"><b>Autorizar anulación · ${a.cantidad}× ${esc(a.item_n)}</b>
      <label class="mut">PIN de la administradora<input id="anu-pin" data-keep type="password" inputmode="numeric" autocomplete="off" placeholder="••••" value="${fv('anu-pin')}"></label>
      ${S.anpE ? `<div style="color:var(--bad);font-size:.9rem">${esc(S.anpE)}</div>` : ''}
      <div style="display:flex;gap:8px"><button class="btn" data-act="anupinok">Autorizar</button><button class="btn-line" data-act="anucancel">Cancelar</button></div></div>`;
  }
  return h;
}
/* solicitudes pendientes, a la vista de la administradora en la pantalla de Mesas */
/* ---------- Avisos en el celular (push): le llegan a la administradora aunque Resto esté cerrado ---------- */
const pushSoporta = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const enPWA = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const b64u = t => { const r = atob((t + '='.repeat((4 - t.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(c => c.charCodeAt(0))); };
async function pushSubActual() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (e) { return null; } }
async function pushGuardar(sub) { const j = sub.toJSON(); return sb.from('resto_push_subs').upsert({ local_id: D.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, quien: S.quien || 'Administradora' }, { onConflict: 'endpoint' }); }
/* Estado: 'no' (apagado), 'si' (activo en este equipo), 'denegado' (bloqueado en el navegador), 'ios' (en iPhone hay que instalar la app primero), 'nosoporta' */
async function pushEstado() {
  if (!pushSoporta()) S.pushOn = 'nosoporta';
  else if (esIOS && !enPWA()) S.pushOn = 'ios';
  else if (Notification.permission === 'denied') S.pushOn = 'denegado';
  else { const sub = await pushSubActual(); S.pushOn = sub ? 'si' : 'no'; if (sub && D && !S.pushSync) { S.pushSync = true; pushGuardar(sub).catch(() => { }); } }
  render();
}
async function pushActivar() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { S.pushOn = perm === 'denied' ? 'denegado' : 'no'; render(); return; }
  const r = await fetch(SB_URL + '/functions/v1/resto-push', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SB_KEY }, body: JSON.stringify({ accion: 'clave' }) });
  const j = r.ok ? await r.json() : {};
  if (!j.clave) throw new Error('El servicio de avisos todavía no está activado. Falta publicar la función resto-push en Supabase.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(j.clave) });
  const g = await pushGuardar(sub); if (g.error) throw new Error(g.error.message);
  S.pushOn = 'si'; render();
}
async function pushApagar() {
  const sub = await pushSubActual();
  if (sub) { const ep = sub.endpoint; await sub.unsubscribe().catch(() => { }); await sb.from('resto_push_subs').delete().eq('endpoint', ep); }
  S.pushOn = 'no'; render();
}
function pushCardHTML() {
  if (!esAdm() || !D) return '';
  if (S.pushOn === undefined) { S.pushOn = null; pushEstado(); }
  const e = S.pushOn;
  if (!e || e === 'nosoporta') return '';
  const caja = t => `<div class="card" style="margin-bottom:12px">${t}</div>`;
  if (e === 'si') return `<p class="mut" style="margin:0 0 10px">🔔 Avisos activados en este equipo: te llega una notificación aunque Resto esté cerrado. <button class="btn-line" style="margin-left:6px" data-act="pushoff">Desactivar</button></p>`;
  if (e === 'ios') return caja(`<b>Avisos en el celular</b><p class="mut" style="margin:4px 0 0">Para recibir avisos en iPhone, primero instala Resto: toca <b>Compartir</b> y luego <b>Agregar a pantalla de inicio</b>. Ábrela desde ese ícono y activa los avisos aquí.</p>`);
  if (e === 'denegado') return caja(`<b>Avisos en el celular</b><p class="mut" style="margin:4px 0 0">Los avisos están bloqueados en este equipo. Actívalos en la configuración del navegador (permiso de notificaciones de este sitio) y vuelve a esta pantalla.</p>`);
  return caja(`<b>Avisos en el celular</b><p class="mut" style="margin:4px 0 8px">Recibe una notificación, aunque Resto esté cerrado, cuando alguien pida anular un producto o un gasto, o se dé un descuento. Actívalo en el celular de la administradora.</p><button class="btn-ok" data-act="pushon">Activar avisos en este equipo</button>`);
}
function anuPendientesHTML() {
  if (!esAdm() || !D.anuOk) return '';
  const p = (D.anulaciones || []).filter(a => a.estado === 'pendiente' && D.comandas.some(c => c.id === a.comanda_id && !c.cerrada));
  if (!p.length) return '';
  return `<div class="card" style="margin-bottom:12px;border:2px solid var(--bad)"><b>Solicitudes de anulación (${p.length})</b>${p.map(a => { const c = D.comandas.find(x => x.id === a.comanda_id); const ya = c && c.estado !== 'pendiente' && !esCafe(c);
    return `<div class="row"><div><b>${nm(a.mesa)}</b> · ${a.cantidad}× ${esc(a.item_n)}${a.garzon ? ' <small class="mut">' + esc(a.garzon) + '</small>' : ''}<div class="mut">${esc(a.motivo || '')}${ya ? ' · <b style="color:var(--bad)">cocina ya lo preparó: quedará como pérdida</b>' : ''}</div></div><div style="display:flex;gap:6px"><button class="btn-ok" data-act="anuaprobar" data-id="${a.id}">Aprobar</button><button class="btn-bad" data-act="anurech" data-id="${a.id}">Rechazar</button></div></div>`; }).join('')}</div>`;
}
function mesaDetalle() {
  const l = L(), n = S.mesa;
  const cats = [...new Set(l.menu.filter(i => i.on).map(i => i.c))];
  const carta = cats.map(c => `<div class="cat">${esc(c)}</div>` + l.menu.filter(i => i.on && i.c === c).map(i => `
    <div class="row"><div>${esc(i.n)}<div class="mut">${money(i.p)}${i.s != null ? (i.s <= 0 ? ' · <b style="color:var(--bad)">Sin stock</b>' : ' · quedan ' + i.s) : ''}</div></div>
    <div class="q"><button data-act="dec" data-id="${i.id}">−</button><span>${S.cart[i.id] || 0}</span><button data-act="inc" data-id="${i.id}" ${i.s != null && (S.cart[i.id] || 0) >= i.s ? 'disabled style="opacity:.4"' : ''}>+</button></div></div>`).join('')).join('');
  const sel = l.menu.filter(i => S.cart[i.id]);
  const subt = sel.reduce((a, i) => a + i.p * S.cart[i.id], 0);
  const ab = abiertas(n), tot = totalMesa(n);
  const env = ab.map(c => `<div class="row" style="align-items:flex-start"><div><span class="pill">${c.estado}</span>${esCafe(c) ? ' <small class="mut">cafetería</small>' : ''}${c.garzon ? ' <small class="mut">' + esc(c.garzon) + '</small>' : ''}${c.items.map((i, ix) => anuItemHTML(c, i, ix)).join('')}</div>${c.estado === 'listo' ? `<button class="btn-ok" data-act="avanzar" data-id="${c.id}" data-to="entregado">Entregado</button>` : ''}</div>`).join('');
  const resta = ab.some(c => c.items.some(i => i.pg));
  const cierre = S.cerrando ? `<div class="card" style="margin-top:12px"><b>Cerrar cuenta · ${nm(n)}</b>
    <div class="row"><span>${resta ? 'Consumo restante' : 'Consumo'}</span><b>${money(tot)}</b></div>
    ${tot > 0 ? camposPago(tot) : '<p class="mut" style="margin:8px 0">Todo está pagado: solo falta cerrar la mesa.</p>'}
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn-ok" data-act="pagar">Confirmar pago</button><button class="btn-line" data-act="nocerrar">Volver</button></div></div>` : '';
  const selSub = ab.reduce((a, c) => a + c.items.reduce((s, i, ix) => s + (S.sel[c.id + ':' + ix] || 0) * i.p, 0), 0);
  const parcial = S.parcial ? `<div class="card" style="margin-top:12px"><b>Cobrar parte de la mesa · ${nm(n)}</b>
    <p class="mut" style="margin:6px 0">Marca lo que consumió quien se retira. Lo que pague se descuenta del total de la mesa.</p>
    ${ab.map(c => c.items.map((i, ix) => { const rem = i.q - (i.pg || 0); return rem <= 0 ? '' : `<div class="row"><div>${esc(i.n)}<div class="mut">${money(i.p)} · quedan ${rem}</div></div><div class="q"><button data-act="pdec" data-c="${c.id}" data-i="${ix}">−</button><span>${S.sel[c.id + ':' + ix] || 0}</span><button data-act="pinc" data-c="${c.id}" data-i="${ix}">+</button></div></div>`; }).join('')).join('')}
    <div class="row"><span>Consumo seleccionado</span><b>${money(selSub)}</b></div>
    ${selSub > 0 ? camposPago(selSub) : ''}
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn-ok" data-act="pagarparte" ${selSub > 0 ? '' : 'disabled'}>Confirmar pago parcial</button><button class="btn-line" data-act="noparcial">Volver</button></div></div>` : '';
  const pd = pedDe(n);
  const pinfo = pd ? `<div class="card" style="margin-bottom:12px"><b>${pd.tipo === 'delivery' ? '🛵 Delivery' : '🥡 Para llevar'}</b> · ${esc(pd.cliente || '')}${pd.telefono ? ' · ' + esc(pd.telefono) : ''}${pd.direccion ? `<div class="mut">${esc(pd.direccion)}</div>` : ''}${!ab.length ? `<button class="btn-bad" style="margin-top:8px" data-act="cancelped">Cancelar pedido</button>` : ''}</div>` : '';
  const rvm = resDe(n);
  const rinfo = rvm ? `<div class="card" style="margin-bottom:12px;border:2px solid var(--brand)"><b>Reserva ${esc(rvm.hora)}</b> · ${esc(rvm.nombre)} · ${rvm.personas} personas${rvm.nota ? `<div class="mut">${esc(rvm.nota)}</div>` : ''}</div>` : '';
  const sinCaja = !puedeCobrarMesa() ? '<p class="mut" style="margin-top:8px;color:var(--bad)">Esta cuenta se cobra en la caja.</p>' : !cajaAbierta() ? '<p class="mut" style="margin-top:8px;color:var(--bad)">La caja está cerrada. La administradora debe abrir la caja para poder cobrar.</p>' : '';
  return `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><button class="btn-line" data-act="volver">← Mesas</button><h2 style="margin:0">${nm(n)}</h2></div>${pinfo}${rinfo}
  <div class="cols"><div class="card"><b>Carta</b>${buscadorHTML()}${carta || '<p class="mut">La carta está vacía. Agrega platos en "Carta y mesas".</p>'}</div>
  <div><div class="card"><b>Nuevo pedido</b>
    ${garzSel(n)}
    ${sel.map(i => `<div class="row"><span>${S.cart[i.id]}× ${esc(i.n)}</span><b>${money(i.p * S.cart[i.id])}</b></div>`).join('') || '<p class="mut" style="margin:8px 0">Agrega platos desde la carta.</p>'}
    <input id="nota" placeholder="Nota (sin cebolla, sin azúcar, etc.)" value="${esc(S.note)}" style="margin-top:8px">${chipsOpc(sel)}
    <div class="total"><span>Subtotal</span><span>${money(subt)}</span></div>
    <button class="btn" style="width:100%;margin-top:8px" data-act="enviar" ${sel.length && (garzonDe(n) || !l.garzones.some(x => x.on)) ? '' : 'disabled'}>${sel.length && sel.every(i => i.e === 'cafeteria') ? 'Anotar cafetería (sale directo)' : sel.some(i => i.e === 'cafeteria') ? 'Enviar a cocina y anotar cafetería' : 'Enviar a cocina'}</button>${!garzonDe(n) && l.garzones.some(x => x.on) ? '<p class="mut" style="margin-top:6px">Elige qué garzón atiende la mesa.</p>' : ''}</div>
  <div class="card" style="margin-top:12px"><b>Pedidos de la mesa</b>${anuFormHTML(n)}${env || '<p class="mut" style="margin:8px 0">Sin pedidos enviados.</p>'}
    <div class="total"><span>Cuenta</span><span>${money(tot)}</span></div>
    <button class="btn-line" style="width:100%;margin-top:8px" data-act="parcial" ${tot > 0 && cajaAbierta() && puedeCobrarMesa() ? '' : 'disabled'}>Cobrar parte (alguien se retira)</button>
    ${ab.length && n < 1000 ? `<div style="margin-top:10px"><label class="mut">Dividir en partes iguales<div style="display:flex;gap:8px;align-items:center"><input id="div-n" data-keep type="number" min="2" max="30" inputmode="numeric" style="width:70px" value="${S.f['div-n'] || 2}"><b>${(+S.f['div-n'] >= 2 ? money(Math.ceil(tot / Math.min(30, +S.f['div-n']))) : money(Math.ceil(tot / 2)))} por persona</b></div></label></div>
    <div style="margin-top:10px"><label class="mut">Mover o unir con otra mesa<div style="display:flex;gap:8px"><select id="mv-mesa" data-keep><option value="">Elige mesa…</option>${mesasLista().filter(x => x !== n).map(x => `<option value="${x}" ${String(S.f['mv-mesa']) === String(x) ? 'selected' : ''}>${nm(x)}${abiertas(x).length ? ' (ocupada: se unen)' : ''}</option>`).join('')}</select><button class="btn-line" data-act="mover">Mover</button></div></label></div>` : ''}
    <button class="btn-ok" style="width:100%;margin-top:8px" data-act="cerrar" ${ab.length && cajaAbierta() && puedeCobrarMesa() ? '' : 'disabled'}>Cerrar cuenta</button>${sinCaja}</div>${cierre}${parcial}</div></div>`;
}
function estacionHTML(esta) {
  const delEsta = (c) => (c.items || []).filter(i => (i.e === 'cafeteria' ? 'cafeteria' : 'cocina') === esta);
  const cs = L().comandas.filter(c => !c.cerrada && c.estado !== 'entregado' && delEsta(c).length).map(c => ({ ...c, items: delEsta(c) })).sort((a, b) => a.t - b.t);
  const col = (est, titulo, cls, btn, next) => `<div class="col"><h3>${titulo} (${cs.filter(c => c.estado === est).length})</h3>` +
    (cs.filter(c => c.estado === est).map(c => `<div class="tk ${cls}"><h4><span>${nm(c.mesa)}${c.garzon ? ' · ' + esc(c.garzon) : ''}</span><span class="pill" ${mins(c.t) >= 20 ? 'style="background:var(--bad);color:#fff"' : mins(c.t) >= 10 ? 'style="background:var(--warn);color:#000"' : ''}>${mins(c.t)} min${mins(c.t) >= 20 ? ' · ATRASADA' : ''}</span></h4>
      <ul>${c.items.map(i => `<li>${i.q}× ${esc(i.n)}</li>`).join('')}</ul>${c.note ? `<em>Nota: ${esc(c.note)}</em>` : ''}
      <button class="btn" style="width:100%" data-act="avanzar" data-id="${c.id}" data-to="${next}">${btn}</button></div>`).join('') || '<p class="mut">Sin comandas</p>') + '</div>';
  if (esta === 'cafeteria') {
    /* registro de lo que salió directo de la cafetería en las mesas abiertas: no hay nada que marcar */
    const todos = L().comandas.filter(c => !c.cerrada && esCafe(c)).sort((a, b) => b.t - a.t);
    return `<h2>Cafetería</h2><div class="card"><p class="mut" style="margin-bottom:8px">Lo de cafetería sale directo de la mesa: queda anotado y no hay que marcar nada. Aquí ves lo servido en las mesas abiertas.</p>` +
      (todos.map(c => `<div class="row"><div><b>${nm(c.mesa)}</b>${c.garzon ? ' <small class="mut">' + esc(c.garzon) + '</small>' : ''} · ${c.items.map(i => i.q + '× ' + esc(i.n)).join(', ')}${c.note ? ` <em class="mut">(${esc(c.note)})</em>` : ''}</div><span class="pill">${mins(c.t)} min</span></div>`).join('') || '<p class="mut">Sin cafés en mesas abiertas.</p>') + '</div>';
  }
  return `<h2>Cocina</h2><div class="kan">${col('pendiente', 'Pendientes', '', 'Empezar a preparar', 'preparando')}${col('preparando', 'Preparando', 'p2', 'Marcar listo', 'listo')}${col('listo', 'Listos para servir', 'p3', 'Entregado en mesa', 'entregado')}</div>`;
}
const cocinaHTML = () => estacionHTML('cocina');
const cafeHTML = () => estacionHTML('cafeteria');
function garzonDe(n) { const a = abiertas(n).find(c => c.garzon); return a ? a.garzon : (S.garzon || ''); }
function garzSel(n) {
  const g = L().garzones.filter(x => x.on); const cur = garzonDe(n);
  if (!g.length) return '<p class="mut" style="margin:6px 0">Sin garzones: agrégalos en "Carta y mesas".</p>';
  const fijo = abiertas(n).some(c => c.garzon) || esGarzonRol();
  return `<label class="mut">Atiende<select id="garz" ${fijo ? 'disabled' : ''}><option value="">— elegir garzón —</option>${g.map(x => `<option ${x.n === cur ? 'selected' : ''}>${esc(x.n)}</option>`).join('')}</select></label>`;
}
function fechaIso(d) { const z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
/* Propinas por garzón, separadas según dónde está el dinero:
   · tarjeta: la propina de cuentas pagadas con tarjeta o transferencia y el recargo extra con tarjeta (el dinero entró por el terminal o el banco; se le paga en efectivo desde la caja)
   · caja: la propina de cuentas pagadas en efectivo y la propina en efectivo que quedó en la caja del vuelto (ya está en la caja; se le paga al cerrar)
   · mano: la propina en efectivo que el cliente le dio directo al garzón (ya la recibió) */
function resumenGarz(rows) {
  const m = {}; rows.forEach(c => { const k = c.garzon || '(sin garzón)'; const o = m[k] || (m[k] = { n: k, cuentas: 0, venta: 0, tarj: 0, caja: 0, mano: 0 }); o.cuentas++; o.venta += c.total;
    if (c.metodo === 'Efectivo') o.caja += c.propina || 0; else o.tarj += c.propina || 0;
    o.tarj += c.pt || 0;
    if (c.pq) o.caja += c.pe || 0; else o.mano += c.pe || 0; });
  Object.values(m).forEach(o => { o.pagar = o.tarj + o.caja; o.prop = o.pagar + o.mano; });
  return Object.values(m).sort((a, b) => b.prop - a.prop);
}
async function garzCargar() {
  if (!S.rpd) S.rpd = fechaIso(new Date()); if (!S.rph) S.rph = S.rpd;
  const d = new Date(S.rpd + 'T00:00:00'), h = new Date(S.rph + 'T00:00:00'); h.setDate(h.getDate() + 1);
  const { data, error } = await sb.from('resto_cuentas').select('*').eq('local_id', D.id).gte('created_at', d.toISOString()).lt('created_at', h.toISOString()).order('created_at');
  S.rp = error ? [] : data.map(r => ({ mesa: r.mesa, total: r.total, propina: r.propina, pe: r.propina_efec || 0, pq: !!r.propina_efec_caja, pt: r.propina_tarj || 0, metodo: r.metodo, garzon: r.garzon || '', t: +new Date(r.created_at) }));
}
function garzHTML() {
  if (!S.rpd) S.rpd = fechaIso(new Date()); if (!S.rph) S.rph = S.rpd;
  if (S.rp === null) { garzCargar().then(render); return '<h2>Garzones</h2><p class="mut">Cargando…</p>'; }
  const r = resumenGarz(S.rp), tp = r.reduce((a, x) => a + x.prop, 0), tv = r.reduce((a, x) => a + x.venta, 0), tm = r.reduce((a, x) => a + x.mano, 0), tpg = r.reduce((a, x) => a + x.pagar, 0), tt = r.reduce((a, x) => a + x.tarj, 0), tc = r.reduce((a, x) => a + x.caja, 0);
  return `<h2>Garzones · ventas y propinas</h2>
  <div class="card" style="display:grid;gap:8px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <label class="mut">Desde<input id="rpd" type="date" value="${S.rpd}"></label><label class="mut">Hasta<input id="rph" type="date" value="${S.rph}"></label></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="rpver">Ver</button><button class="btn-line" data-act="rphoy">Hoy</button><button class="btn-line" data-act="rpsem">Últimos 7 días</button><button class="btn-line" data-act="rpmes">Este mes</button><button class="btn-ok" data-act="rpcsv">Descargar Excel (CSV)</button></div></div>
  ${L().adminPin ? `<div class="card" style="margin-top:12px"><b>PIN de los garzones</b><p class="mut">PIN de cada garzón (vacío = entra sin PIN). Todos los garzones cobran sus mesas. "Cobra mostrador" además le permite vender por mostrador y usar la pestaña Caja; para autorizarlo necesita PIN.</p>${L().garzones.map(g => `<div class="row"><div>${esc(g.n)}<div class="mut">${g.pin ? 'con PIN' : 'sin PIN'} · ${g.pin && g.cj ? '<b style="color:var(--ok)">cobra mostrador</b>' : 'solo mesas'}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><input id="gp-${g.id}" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" style="width:90px"><button class="btn-line" data-act="setgpin" data-id="${g.id}">Guardar PIN</button><button class="${g.pin && g.cj ? 'btn-bad' : 'btn-ok'}" data-act="gcaja" data-id="${g.id}">${g.pin && g.cj ? 'Quitar mostrador' : 'Autorizar mostrador'}</button></div></div>`).join('') || ''}</div>` : '<div class="card" style="margin-top:12px"><b>PIN de los garzones</b><p class="mut">Primero crea el PIN de la administradora en "Carta y mesas" para poder asignar PIN a los garzones.</p></div>'}
  <div class="card" style="margin-top:12px"><b>Propinas por garzón</b><p class="mut" style="margin:4px 0 8px">Cada propina se muestra según dónde está el dinero, para que la caja cuadre: <b>tarjeta o transferencia</b> (entró por el terminal o el banco y se le paga en efectivo desde la caja), <b>efectivo en caja</b> (quedó en la caja, por ejemplo del vuelto, y se le paga al cerrar) y <b>directo en mano</b> (el cliente se la dio al garzón: ya la recibió).</p>
    ${r.map(x => `<div class="row" style="align-items:flex-start"><div>${esc(x.n)}<div class="mut">${x.cuentas} cuenta${x.cuentas === 1 ? '' : 's'} · ventas ${money(x.venta)}</div>
      <div class="mut" style="margin-top:4px">💳 Tarjeta o transferencia <b>${money(x.tarj)}</b> · 💵 Efectivo en caja <b>${money(x.caja)}</b> · 🤝 Directo en mano <b>${money(x.mano)}</b></div></div>
      <div style="text-align:right"><b>${money(x.prop)}</b><div class="mut">Se le paga de la caja</div><b style="color:var(--ok)">${money(x.pagar)}</b></div></div>`).join('') || '<p class="mut" style="margin-top:8px">Sin cuentas cerradas en ese período.</p>'}
    <div class="total"><span>Total propinas</span><span>${money(tp)}</span></div>
    <div class="row"><span class="mut">💳 Tarjeta o transferencia</span><span class="mut">${money(tt)}</span></div>
    <div class="row"><span class="mut">💵 Efectivo en caja</span><span class="mut">${money(tc)}</span></div>
    <div class="row"><span class="mut">🤝 Directo en mano (ya recibido)</span><span class="mut">${money(tm)}</span></div>
    <div class="row"><b>Total a pagar desde la caja</b><b>${money(tpg)}</b></div>
    <div class="row"><span class="mut">Total ventas</span><span class="mut">${money(tv)}</span></div></div>
  <p class="mut" style="margin-top:12px">"Se le paga de la caja" es lo que cada garzón debe retirar de la caja: tarjeta o transferencia más efectivo en caja. Lo que recibió directo en mano no se paga de nuevo. Las cuentas sin garzón elegido aparecen como "(sin garzón)".</p>`;
}
function garzCSV() {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  let t = '﻿Garzón;Cuentas;Ventas;Propina tarjeta o transferencia;Propina efectivo en caja;Propina directa en mano;Total propinas;A pagar desde la caja\n' + resumenGarz(S.rp).map(x => [q(x.n), x.cuentas, x.venta, x.tarj, x.caja, x.mano, x.prop, x.pagar].join(';')).join('\n');
  t += '\n\nFecha;Mesa;Garzón;Consumo;Propina 10%;Propina extra tarjeta;Propina efectivo en caja;Propina efectivo directa;Forma de pago\n' + S.rp.map(c => [new Date(c.t).toLocaleString('es-CL'), c.mesa === 0 ? 'Mostrador' : c.mesa >= 1000 ? 'Pedido ' + (c.mesa - 1000) : c.mesa > 100 ? 'Piso 2 - ' + (c.mesa - 100) : c.mesa, q(c.garzon), c.total, c.propina, c.pt || 0, c.pq ? c.pe || 0 : 0, c.pq ? 0 : c.pe || 0, c.metodo].join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' }));
  a.download = 'propinas_' + S.rpd + '_a_' + S.rph + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
/* ---------- Comandas por garzón (solo administradora): revisar lo que se envió para detectar errores de venta ---------- */
async function cmPagina(tabla, d, h) {
  let rows = [], err = false;
  for (let p = 0; p < 10; p++) {
    const r = await sb.from(tabla).select('*').eq('local_id', D.id).gte('created_at', d.toISOString()).lt('created_at', h.toISOString()).order('created_at', { ascending: false }).range(p * 1000, p * 1000 + 999);
    if (r.error) { err = true; break; }
    rows = rows.concat(r.data || []); if ((r.data || []).length < 1000) break;
  }
  return { rows, err };
}
async function cmCargar() {
  if (!S.cmd) S.cmd = fechaIso(new Date()); if (!S.cmh) S.cmh = S.cmd;
  const d = new Date(S.cmd + 'T00:00:00'), h = new Date(S.cmh + 'T00:00:00'); h.setDate(h.getDate() + 1);
  const [a, b, an] = await Promise.all([cmPagina('resto_comandas', d, h), cmPagina('resto_cuentas', d, h), cmPagina('resto_anulaciones', d, h)]);
  S.cm = {
    err: a.err || b.err,
    rows: a.rows.map(r => ({ id: r.id, mesa: r.mesa, items: r.items || [], nota: r.nota || '', garzon: r.garzon || '(sin garzón)', estado: r.estado, cerrada: !!r.cerrada, est: (r.items && r.items[0] && r.items[0].e === 'cafeteria') ? 'cafeteria' : 'cocina', t: +new Date(r.created_at) })),
    cuentas: b.rows.map(r => ({ mesa: r.mesa, total: r.total, garzon: r.garzon || '(sin garzón)' })),
    anu: an.err ? [] : an.rows.map(r => ({ t: +new Date(r.created_at), mesa: r.mesa, garzon: r.garzon || '(sin garzón)', n: r.item_n, q: r.cantidad, p: r.precio, motivo: r.motivo || '', estado: r.estado, por: r.resuelta_por || '', pedida: r.pedida_por || '', perdida: !!r.perdida }))
  };
}
const cmValor = c => c.items.reduce((s, i) => s + i.q * i.p, 0);
const cmPend = c => c.cerrada ? 0 : c.items.reduce((s, i) => s + (i.q - (i.pg || 0)) * i.p, 0);
const cmMesaTxt = m => m === 0 ? 'Mostrador' : m >= 1000 ? 'Pedido ' + (m - 1000) : m > 100 ? 'Piso 2 · Mesa ' + (m - 100) : 'Mesa ' + m;
function cmFiltradas() { const g = S.f.cmg || ''; return S.cm.rows.filter(c => !g || c.garzon === g); }
const cmAnu = () => (S.cm.anu || []).filter(x => !(S.f.cmg || '') || x.garzon === S.f.cmg);
function anuListaHTML() {
  const l = cmAnu(); if (!l.length) return '';
  const col = { aprobada: 'var(--ok)', rechazada: 'var(--bad)', pendiente: '#92400e' };
  return `<div class="card" style="margin-top:12px"><b>Anulaciones de productos (${l.length})</b><p class="mut" style="margin:4px 0">Productos que se quitaron de la cuenta después de enviarlos, con el motivo y quién lo autorizó.</p>${l.map(x => `<div class="row" style="align-items:flex-start"><div><b>${esc(cmMesaTxt(x.mesa))}</b> · ${hora(x.t)} · ${esc(x.garzon)}<div>${x.q}× ${esc(x.n)} <span class="mut">${money(x.p)}</span></div><div class="mut">${esc(x.motivo)}${x.por ? ' · autorizó ' + esc(x.por) : ''}${x.perdida ? ' · <b style="color:var(--bad)">pérdida (ya preparado)</b>' : ''}</div></div><b style="color:${col[x.estado] || 'inherit'}">${esc(x.estado)}</b></div>`).join('')}</div>`;
}
function comsHTML() {
  if (!S.cmd) S.cmd = fechaIso(new Date()); if (!S.cmh) S.cmh = S.cmd;
  if (S.cm === null || S.cm === undefined) { cmCargar().then(render); return '<h2>Comandas</h2><p class="mut">Cargando…</p>'; }
  const garz = [...new Set(S.cm.rows.map(c => c.garzon))].sort();
  const por = {};
  S.cm.rows.forEach(c => { const o = por[c.garzon] || (por[c.garzon] = { n: c.garzon, cant: 0, env: 0, pend: 0, cob: 0 }); o.cant++; if (c.mesa !== 0) { o.env += cmValor(c); o.pend += cmPend(c); } });
  S.cm.cuentas.filter(c => c.mesa !== 0).forEach(c => { const o = por[c.garzon] || (por[c.garzon] = { n: c.garzon, cant: 0, env: 0, pend: 0, cob: 0 }); o.cob += c.total; });
  const res = Object.values(por).sort((a, b) => b.env - a.env);
  const fil = cmFiltradas(), sel = S.f.cmg || '';
  const estPill = c => `<span class="pill">${c.est === 'cafeteria' ? 'Cafetería' : 'Cocina'}</span> <span class="pill">${esc(c.estado || '')}</span>${c.cerrada ? ' <span class="pill" style="background:#dcfce7;color:var(--ok)">cobrada</span>' : ''}`;
  return `<h2>Comandas enviadas por garzón</h2>
  <div class="card" style="display:grid;gap:8px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <label class="mut">Desde<input id="cmd" type="date" value="${S.cmd}"></label><label class="mut">Hasta<input id="cmh" type="date" value="${S.cmh}"></label></div>
    <label class="mut">Garzón<select id="cmg" data-keep><option value="">Todos</option>${garz.map(g => `<option ${g === sel ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="cmver">Ver</button><button class="btn-line" data-act="cmhoy">Hoy</button><button class="btn-line" data-act="cmsem">Últimos 7 días</button><button class="btn-line" data-act="cmmes">Este mes</button><button class="btn-ok" data-act="cmcsv">Descargar Excel (CSV)</button></div></div>
  ${S.cm.err ? '<div class="card" style="margin-top:12px;color:var(--bad)">No se pudieron cargar todos los datos. Intenta de nuevo con "Ver".</div>' : ''}
  <div class="card" style="margin-top:12px"><b>Resumen por garzón</b>${res.map(x => { const dif = x.env - x.pend - x.cob; return `<div class="row"><div>${esc(x.n)}<div class="mut">${x.cant} comanda${x.cant === 1 ? '' : 's'} · enviado ${money(x.env)} · cobrado ${money(x.cob)}${x.pend ? ' · mesas abiertas ' + money(x.pend) : ''}</div></div><b style="color:${dif === 0 ? 'var(--ok)' : 'var(--bad)'}">${dif === 0 ? 'Cuadra' : (dif > 0 ? 'Falta cobrar ' : 'Cobró de más ') + money(Math.abs(dif))}</b></div>`; }).join('') || '<p class="mut" style="margin-top:8px">Sin comandas en ese período.</p>'}
    <p class="mut" style="margin-top:8px">"Cuadra" significa que lo enviado coincide con lo cobrado más lo que sigue en mesas abiertas. Si no cuadra, revisa las comandas de ese garzón abajo (ítems anotados de más o de menos, descuentos, cobros distintos). Las comandas del mostrador llegan a cocina ya pagadas, por eso no entran en esta comparación.</p></div>
  <div class="card" style="margin-top:12px"><b>Detalle de comandas${sel ? ' · ' + esc(sel) : ''} (${fil.length})</b>${fil.map(c => `<div class="row" style="align-items:flex-start"><div><b>${esc(cmMesaTxt(c.mesa))}</b> · ${hora(c.t)} · ${esc(c.garzon)}<div style="margin:4px 0">${estPill(c)}</div>${c.items.map(i => `<div>${i.q}× ${esc(i.n)} <span class="mut">${money(i.p)}</span></div>`).join('')}${c.nota ? `<div class="mut">Nota: ${esc(c.nota)}</div>` : ''}</div><b>${money(cmValor(c))}</b></div>`).join('') || '<p class="mut" style="margin-top:8px">Sin comandas para mostrar.</p>'}</div>${anuListaHTML()}`;
}
function cmCSV() {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const t = '﻿Fecha;Mesa;Garzón;Estación;Estado;Cobrada;Detalle;Nota;Valor\n' + cmFiltradas().map(c => [new Date(c.t).toLocaleString('es-CL'), q(cmMesaTxt(c.mesa)), q(c.garzon), c.est === 'cafeteria' ? 'Cafetería' : 'Cocina', c.estado || '', c.cerrada ? 'Sí' : 'No', q(c.items.map(i => i.q + 'x ' + i.n + ' (' + i.p + ')').join(', ')), q(c.nota), cmValor(c)].join(';')).join('\n') + (cmAnu().length ? '\n\nAnulaciones\nFecha;Mesa;Garzón;Producto;Cantidad;Precio;Motivo;Estado;Autorizó;Pérdida\n' + cmAnu().map(x => [new Date(x.t).toLocaleString('es-CL'), q(cmMesaTxt(x.mesa)), q(x.garzon), q(x.n), x.q, x.p, q(x.motivo), x.estado, q(x.por), x.perdida ? 'Sí' : 'No'].join(';')).join('\n') : '');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv;charset=utf-8' }));
  a.download = 'comandas_' + S.cmd + '_a_' + S.cmh + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
async function turnoCargar() {
  const { data } = await sb.from('resto_turnos').select('*').eq('local_id', D.id).not('cerrado_at', 'is', null).order('abierto_at', { ascending: false }).limit(15);
  S.th = data || [];
}
/* Fecha de corte del cierre: la administradora puede cerrar el turno solo hasta el final de un día pasado (ej. cerrar ayer cuando hoy ya hay ventas).
   Lo posterior al corte pasa al turno nuevo. Devuelve el corte en milisegundos o null si se cierra todo el turno. */
function corteDe(t) {
  const v = +(S.f['c-corte'] || 0);
  return t && v > +new Date(t.abierto_at) && v <= Date.now() ? v : null;
}
function cortesPosibles(t) {
  const out = [], a = new Date(t.abierto_at); let d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1, 0, 0, 0, 0);
  while (+d > +a && +d <= Date.now() && out.length < 31) { out.push(+d); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0); }
  return out;
}
const diaCorte = ms => { const d = new Date(ms - 1); return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }); };
const enCorte = (t, ms, hasta) => !hasta || ms <= hasta;
function turnoRes(t) {
  const hasta = corteDe(t), cu = D.cuentas.filter(c => c.t >= +new Date(t.abierto_at) && enCorte(t, c.t, hasta)); let ef = 0, tj = 0, tr = 0, pr = 0, vt = 0;
  cu.forEach(c => { vt += c.total; const cobro = c.total + c.propina; if (c.metodo === 'Efectivo') ef += cobro; else if (c.metodo === 'Tarjeta') tj += cobro + c.pt; else tr += cobro; if (c.pq) ef += c.pe; pr += c.propina + c.pe + c.pt; });
  const gsT = (D.gastos || []).filter(g => g.turno_id === t.id && !g.anul && enCorte(t, g.t, hasta)), gs = gsT.filter(g => g.tipo !== 'Retiro'), rts = gsT.filter(g => g.tipo === 'Retiro'), gt = gs.reduce((a, g) => a + g.m, 0), rt = rts.reduce((a, g) => a + g.m, 0);
  /* Propinas por garzón del turno. Se pagan en efectivo desde la caja: la propina de las cuentas (10%) y la propina extra con tarjeta.
     La propina en efectivo que quedó en la caja (del vuelto) también se le paga al cerrar; la que le dieron directo en la mano (pe) ya la recibió: solo se muestra. Cada turno nuevo parte en cero. */
  const pg = {}; cu.forEach(c => { const n = c.garzon || ''; const o = pg[n] || (pg[n] = { n, c: 0, pc: 0, pt: 0, pe: 0, pq: 0, m: 0 }); o.c++; o.pc += c.propina; o.pt += c.pt; if (c.pq) o.pq += c.pe; else o.pe += c.pe; o.m += c.propina + c.pt + (c.pq ? c.pe : 0); });
  const propGar = Object.values(pg).filter(o => o.n && o.m > 0).sort((a, b) => a.n.localeCompare(b.n)), sinGar = (pg[''] || { m: 0 }).m;
  const pp = propGar.reduce((a, o) => a + o.m, 0);
  const dsc = cu.filter(c => c.desc > 0), dt = dsc.reduce((a, c) => a + c.desc, 0);
  return { cuentas: cu.length, vt, ef, tj, tr, pr, gt, gs: gs.length, pp, propGar, sinGar, dsc, dt, rt, rts: rts.length, esp: (t.monto_inicial || 0) + ef - gt - rt - pp };
}
const hora = t => new Date(t).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function cajerosHTML(t) {
  const cu = D.cuentas.filter(c => c.turno_id === t.id), por = {};
  cu.forEach(c => { const k = c.cobrado_por || c.garzon || '(sin usuario)'; const o = por[k] || (por[k] = { n: 0, v: 0 }); o.n++; o.v += c.total; });
  const nombres = [...new Set([...(D.sesiones || []).map(x => x.usuario), ...Object.keys(por)])];
  const h = x => new Date(x).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  return nombres.map(n => { const ses = (D.sesiones || []).filter(x => x.usuario === n), o = por[n] || { n: 0, v: 0 }; const activo = ses.some(x => !x.salida);
    return `<div class="row"><div><b>${esc(n)}</b> ${activo ? '<span class="pill" style="background:#dcfce7;color:var(--ok)">en caja</span>' : ''}<div class="mut">${ses.map(x => h(x.entrada) + (x.salida ? '–' + h(x.salida) : ' en adelante')).join(' · ') || 'sin registro de entrada'} · ${o.n} cobro${o.n === 1 ? '' : 's'}</div></div><b>${money(o.v)}</b></div>`; }).join('') || '<p class="mut" style="margin-top:8px">Aún nadie ha cobrado en este turno.</p>';
}
/* ---------- Conteo de billetes y monedas (apertura y cierre de caja) ---------- */
const DEN = [[20000, 'Billetes de $20.000'], [10000, 'Billetes de $10.000'], [5000, 'Billetes de $5.000'], [2000, 'Billetes de $2.000'], [1000, 'Billetes de $1.000'], [500, 'Monedas de $500'], [100, 'Monedas de $100'], [50, 'Monedas de $50'], [10, 'Monedas de $10']];
const dnId = (p, v) => 'dn' + p + '-' + v;
/* El cajero escribe el MONTO EN PESOS de cada tipo (ej. 4 billetes de $20.000 → 80000). Solo cuentan los dígitos: sirve "80.000", "$80.000" o "80000". */
const dnM = (p, v) => { const d = String(S.f[dnId(p, v)] ?? '').replace(/\D/g, ''); return d ? Math.min(+d, 100000000) : 0; };
const dnOk = (p, v) => dnM(p, v) % v === 0;
const dnBad = p => DEN.filter(([v, n]) => !dnOk(p, v));
const dnQ = (p, v) => Math.floor(dnM(p, v) / v);
const dnTotal = p => DEN.reduce((a, [v]) => a + dnM(p, v), 0);
const dnSub = (p, v) => dnM(p, v) === 0 ? { t: '', bad: false } : dnOk(p, v) ? { t: dnQ(p, v) + (v >= 1000 ? (dnQ(p, v) === 1 ? ' billete' : ' billetes') : (dnQ(p, v) === 1 ? ' moneda' : ' monedas')), bad: false } : { t: 'no calza', bad: true };
const dnObj = p => { const o = {}; DEN.forEach(([v]) => { if (dnQ(p, v)) o[v] = dnQ(p, v); }); return o; }; /* se guarda como cantidades {valor: cantidad}, igual que antes */
const dnTxt = o => o && Object.keys(o).length ? Object.keys(o).map(Number).sort((a, b) => b - a).map(v => o[v] + '×' + money(v)).join(' · ') : '';
const numF = k => { const v = S.f[k]; return v === undefined || v === '' || isNaN(+v) ? null : Math.max(0, Math.round(+v)); };
function contadorHTML(p) {
  return `<div>${DEN.map(([v, n]) => `<label class="dnrow"><span>${n}</span><input id="${dnId(p, v)}" data-keep type="text" inputmode="numeric" autocomplete="off" placeholder="$0" value="${fv(dnId(p, v))}"><b id="${dnId(p, v)}-s" class="mut" style="${dnSub(p, v).bad ? 'color:var(--bad)' : ''}">${dnSub(p, v).t}</b></label>`).join('')}
    <div class="total"><span>Total en billetes y monedas</span><span id="dnt-${p}">${money(dnTotal(p))}</span></div></div>`;
}
/* Resultado del cuadre: compara lo que se contó con lo que el sistema registró como vendido en el turno */
function cuadreHTML(t) {
  const r = turnoRes(t), ec = dnTotal('c'), hayEf = DEN.some(([v]) => S.f[dnId('c', v)] !== undefined && S.f[dnId('c', v)] !== ''), tj = numF('ctarj'), tr = numF('ctrans');
  const fila = (n, esp, got, extra) => { const d = got - esp; return `<div class="row"><div>${n}<div class="mut">Sistema ${money(esp)} · contado ${money(got)}${extra || ''}</div></div><b style="color:${d === 0 ? 'var(--ok)' : 'var(--bad)'}">${d === 0 ? 'Cuadra' : (d > 0 ? 'Sobra ' : 'Falta ') + money(Math.abs(d))}</b></div>`; };
  const out = [];
  if (hayEf) out.push(fila('Efectivo', r.esp, ec, ' · incluye ' + money(t.monto_inicial || 0) + ' de sencillo inicial' + [r.gt ? money(r.gt) + ' de gastos' : '', r.rt ? money(r.rt) + ' de retiros' : '', r.pp ? money(r.pp) + ' de propinas pagadas' : ''].filter(Boolean).reduce((a, x, i, arr) => a + (i === 0 ? ' y descuenta ' : i === arr.length - 1 ? ' y ' : ', ') + x, '')));
  if (tj !== null) out.push(fila('Tarjetas', r.tj, tj));
  if (tr !== null) out.push(fila('Transferencias', r.tr, tr));
  const dif = (hayEf ? ec - r.esp : 0) + (tj !== null ? tj - r.tj : 0) + (tr !== null ? tr - r.tr : 0), mal = (hayEf && ec !== r.esp) || (tj !== null && tj !== r.tj) || (tr !== null && tr !== r.tr);
  const banner = out.length ? `<div class="cuadre-b ${mal ? 'mal' : 'ok'}">${mal ? '⚠️ La caja tiene diferencias. Revisa lo contado o escribe una observación.' : '✅ ¡La caja cuadra!'}</div>` : '';
  return banner + (out.join('') || '<p class="mut">Escribe lo que contaste para ver si la caja cuadra.</p>') + retiroHTML();
}
/* Sencillo fijo: lo que siempre debe quedar en caja. Lo demás del efectivo contado es efectivo de ventas y se retira. */
function retiroHTML() {
  const fondo = D.fondo || 0, ec = dnTotal('c'), dj = dnTotal('d'), hayD = DEN.some(([v]) => S.f[dnId('d', v)] !== undefined && S.f[dnId('d', v)] !== '');
  if (!hayD && !ec) return '';
  const ret = ec - dj, dif = dj - fondo;
  return `<div class="row" style="margin-top:6px"><div>Sencillo que queda en caja<div class="mut">${fondo ? 'Debe quedar ' + money(fondo) + ' · dejas ' + money(dj) : 'Dejas ' + money(dj)}</div></div><b style="color:${!fondo || dif === 0 ? 'var(--ok)' : 'var(--bad)'}">${!fondo ? '' : dif === 0 ? 'Correcto' : (dif > 0 ? 'Sobra ' : 'Falta ') + money(Math.abs(dif))}</b></div>
    <div class="row"><div><b>Efectivo de ventas a retirar</b><div class="mut">Efectivo contado ${money(ec)} − sencillo que queda ${money(dj)}</div></div><b style="color:${ret < 0 ? 'var(--bad)' : ''}">${ret < 0 ? 'Revisa los montos' : money(ret)}</b></div>`;
}
function dnActualiza() {
  ['a', 'c', 'd'].forEach(p => { DEN.forEach(([v]) => { const el = document.getElementById(dnId(p, v) + '-s'); if (el) { const x = dnSub(p, v); el.textContent = x.t; el.style.color = x.bad ? 'var(--bad)' : ''; } }); const t = document.getElementById('dnt-' + p); if (t) t.textContent = money(dnTotal(p)); });
  const c = document.getElementById('cuadre'); if (c && D && D.turno) c.innerHTML = cuadreHTML(D.turno);
  const ap = document.getElementById('aper'); if (ap) ap.innerHTML = aperturaChk();
}
function aperturaChk() {
  const a = dnTotal('a'), f = D.fondo || 0; if (!a) return '';
  if (!f) return `<div class="cuadre-b ok">Abres con ${money(a)}</div>`;
  const d = a - f; return d === 0 ? `<div class="cuadre-b ok">✅ Coincide con el sencillo fijo (${money(f)})</div>` : `<div class="cuadre-b mal">⚠️ ${d > 0 ? 'Sobran ' : 'Faltan '}${money(Math.abs(d))} respecto del sencillo fijo (${money(f)})</div>`;
}
function abrirCajaHTML() {
  return `<div class="card" style="display:grid;gap:10px"><b style="font-size:1.1rem">Abrir caja</b>
    <div class="paso"><span class="num">1</span><div><b>Cuenta el sencillo con el que recibes la caja</b><p class="mut" style="margin:2px 0 0">Escribe en pesos cuánto hay de cada tipo. Ejemplo: 4 billetes de $20.000 = 80000.${D.fondo ? ' Debes recibir <b>' + money(D.fondo) + '</b>.' : ''}</p></div></div>
    ${contadorHTML('a')}<div id="aper">${aperturaChk()}</div>
    <div class="paso"><span class="num">2</span><div><b>Abre la caja</b><p class="mut" style="margin:2px 0 0">Desde aquí se cuentan las ventas, los gastos y los retiros del turno.</p></div></div>
    <button class="btn-ok" data-act="tabrir">Abrir caja</button></div>`;
}
function corteHTML(t) {
  if (!esAdm()) return '';
  const cs = cortesPosibles(t); if (!cs.length) return '';
  const hasta = corteDe(t), fuera = hasta ? D.cuentas.filter(c => c.t >= +new Date(t.abierto_at) && c.t > hasta).length : 0;
  return `<div class="card" style="background:#fff7ed;padding:10px;display:grid;gap:6px"><label><b>¿Hasta cuándo cierras?</b>
    <select id="c-corte" data-keep style="width:100%;margin-top:4px"><option value="">Todo el turno, hasta ahora</option>${cs.map(ms => `<option value="${ms}" ${hasta === ms ? 'selected' : ''}>Solo hasta el día ${diaCorte(ms)} (23:59)</option>`).join('')}</select></label>
    ${hasta ? `<p class="mut" style="margin:0">Se cierra solo lo cobrado, gastado y retirado hasta el ${diaCorte(hasta)} a las 23:59. ${fuera ? 'Los ' + fuera + ' cobro' + (fuera === 1 ? '' : 's') + ' de después, con sus gastos y retiros, pasan al turno nuevo.' : 'Lo de después pasa al turno nuevo.'} Cuenta el efectivo como estaba al terminar ese día.</p>` : '<p class="mut" style="margin:0">Elige un día anterior si el turno quedó abierto y quieres cerrar solo ese día.</p>'}</div>`;
}
function cerrarCajaHTML(t) {
  const r = turnoRes(t);
  return `<div class="card" style="margin-top:12px;display:grid;gap:10px"><b style="font-size:1.1rem">Cerrar caja (cuadre del día)</b>${corteHTML(t)}
    <div class="paso"><span class="num">1</span><div><b>Entrega las propinas</b><p class="mut" style="margin:2px 0 0">${r.pp ? 'Paga ' + money(r.pp) + ' en efectivo a los garzones (detalle arriba) antes de contar.' : 'No hay propinas por pagar en este turno.'}</p></div></div>
    <div class="paso"><span class="num">2</span><div><b>Efectivo contado</b><p class="mut" style="margin:2px 0 0">Escribe en pesos cuánto hay de cada billete y moneda (ej.: 4 billetes de $20.000 = 80000). Debe haber <b>${money(r.esp)}</b>.</p></div></div>
    ${contadorHTML('c')}
    <div class="paso"><span class="num">3</span><div><b>Tarjetas y transferencias</b><p class="mut" style="margin:2px 0 0">Anota el total del terminal de tarjetas y lo recibido por transferencia (0 si no hubo).</p></div></div>
    <label class="mut">Tarjetas: total según el terminal<input id="ctarj" data-keep type="number" inputmode="numeric" min="0" placeholder="0 si no hubo" value="${fv('ctarj')}"></label>
    <label class="mut">Transferencias recibidas<input id="ctrans" data-keep type="number" inputmode="numeric" min="0" placeholder="0 si no hubo" value="${fv('ctrans')}"></label>
    <div class="paso"><span class="num">4</span><div><b>Sencillo que queda en caja${D.fondo ? ' (debe ser ' + money(D.fondo) + ')' : ''}</b><p class="mut" style="margin:2px 0 0">Separa el sencillo para vueltos y escribe qué billetes y monedas dejas. El resto del efectivo es de ventas y se retira.</p></div></div>
    ${contadorHTML('d')}
    <div class="paso"><span class="num">5</span><div><b>Cuadre con lo vendido</b></div></div>
    <div class="card" style="background:#f8fafc;padding:10px"><div id="cuadre">${cuadreHTML(t)}</div></div>
    <input id="tnota" data-keep placeholder="Observación (obligatoria si hay diferencia)" value="${fv('tnota')}"><button class="btn-bad" data-act="tcerrar">Cerrar caja</button></div>`;
}
/* ---------- Sencillo fijo y gastos pagados desde caja ---------- */
const GTIPOS = ['Boleta', 'Factura', 'Sin documento'];
function fondoHTML() {
  return `<div class="card" style="margin-bottom:12px"><b>Sencillo fijo de la caja</b><p class="mut" style="margin:4px 0 8px">Es el dinero para dar vueltos que siempre debe quedar en la caja. Al cerrar, quien está en caja separa este monto, deja el detalle de billetes y monedas y retira el resto del efectivo de ventas.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="fondo-in" data-keep inputmode="numeric" autocomplete="off" placeholder="Ej.: 160000" style="flex:1;min-width:150px" value="${S.f['fondo-in'] === undefined ? (D.fondo || '') : fv('fondo-in')}"><button class="btn-ok" data-act="setfondo">Guardar sencillo fijo</button></div>
    <div class="mut" style="margin-top:6px">Actual: <b>${D.fondo ? money(D.fondo) : 'sin definir'}</b></div></div>`;
}
/* Una fila de gasto. Los anulados quedan a la vista tachados (el registro nunca se borra). Solo se pueden anular los del turno abierto. */
function gastoFila(g, editable) {
  const doc = `<b>${g.anul ? '<s>' : ''}${esc(g.tipo)}${g.num ? ' N° ' + esc(g.num) : ''}${g.anul ? '</s>' : ''}</b> · ${esc(g.prov || 'sin proveedor')}`;
  const sub = `${esc(g.det)} · ${hora(g.t)} · ${esc(g.por || '')}`;
  let extra = '';
  if (g.mOrig != null && g.mOrig !== g.m) extra += `<div class="mut" style="color:var(--warn)">Corregido por ${esc(g.edPor || 'la administradora')}: era ${money(g.mOrig)} · ${esc(g.edMot)}</div>`;
  if (g.anul) extra += `<div class="mut" style="color:var(--bad)">Anulado por ${esc(g.anPor)}: ${esc(g.anMot)}</div>`;
  else if (g.pedMot) extra += `<div class="mut" style="color:var(--warn)">Anulación solicitada por ${esc(g.pedPor)}: ${esc(g.pedMot)}${editable && !esAdm() ? ' · espera a la administradora' : ''}</div>`;
  const btn = !editable || g.anul ? '' : esAdm() ? `<button class="btn-line" data-act="geditar" data-id="${g.id}">Corregir monto</button> <button class="btn-bad" data-act="ganular" data-id="${g.id}">Anular</button>` : g.pedMot ? '' : `<button class="btn-line" data-act="gpedir" data-id="${g.id}">Pedir anulación</button>`;
  return `<div class="row"><div>${doc}<div class="mut">${sub}</div>${extra}</div><div style="text-align:right"><b style="${g.anul ? 'text-decoration:line-through;color:var(--mut)' : ''}">${money(g.m)}</b>${btn ? '<div style="margin-top:4px">' + btn + '</div>' : ''}</div></div>`;
}
/* Cobros del turno: la administradora puede corregir la forma de pago si el cajero se equivocó (queda el original y el motivo) */
const METODOS = ['Efectivo', 'Tarjeta', 'Transferencia'];
function cobrosHTML(t) {
  if (!esAdm()) return '';
  const hasta = corteDe(t), cu = D.cuentas.filter(c => c.t >= +new Date(t.abierto_at) && enCorte(t, c.t, hasta)).sort((a, b) => b.t - a.t);
  return `<div class="card" style="margin-top:12px"><b>Cobros del turno</b><p class="mut" style="margin:4px 0 8px">Si se cobró con una forma de pago equivocada (por ejemplo, se anotó tarjeta y fue efectivo), corrígela aquí. El cuadre de caja se recalcula y el cambio queda registrado.</p>
    ${cu.map(c => `<div class="row"><div><b>${esc(c.mesa > 0 ? nm(c.mesa) : 'Mostrador')}</b> · ${esc(c.metodo)}<div class="mut">${hora(c.t)} · ${esc(c.cobrado_por || c.garzon || '')}${c.pt ? ' · incluye propina extra con tarjeta ' + money(c.pt) : ''}</div>${c.mOrig && c.mOrig !== c.metodo ? `<div class="mut" style="color:var(--warn)">Corregido por ${esc(c.mPor || 'la administradora')}: era ${esc(c.mOrig)} · ${esc(c.mMot)}</div>` : ''}</div><div style="text-align:right"><b>${money(c.total + c.propina + c.pt)}</b><div style="margin-top:4px"><button class="btn-line" data-act="cmetodo" data-id="${c.id}">Corregir forma de pago</button></div></div></div>`).join('') || '<p class="mut" style="margin:0">Aún no hay cobros en este turno.</p>'}</div>`;
}
function descuentosHTML(t) {
  const r = turnoRes(t); if (!r.dsc.length) return '';
  return `<div class="card" style="margin-top:12px"><b>Descuentos y cortesías del turno</b> <span class="mut">· total ${money(r.dt)}</span>
    ${r.dsc.map(c => `<div class="row"><div>${esc(c.mesa > 0 ? nm(c.mesa) : 'Mostrador')} · ${esc(c.garzon || c.cobrado_por || '')}<div class="mut">${esc(c.descM || 'Sin motivo')} · autorizó ${esc(c.descA || '—')}</div></div><b style="color:var(--bad)">−${money(c.desc)}</b></div>`).join('')}</div>`;
}
function propinasHTML(t) {
  const r = turnoRes(t);
  return `<div class="card" style="margin-top:12px"><b>Propinas de los garzones (se pagan al cerrar)</b>
    <p class="mut" style="margin:4px 0 8px">Cada garzón recibe en efectivo, desde la caja, la propina acumulada de sus ventas de este turno (la propina de la cuenta, la propina extra con tarjeta y la propina en efectivo que quedó en la caja del vuelto). Primero entrega las propinas y después cuenta el efectivo que queda. Al cerrar la caja el acumulado vuelve a cero para el turno siguiente.</p>
    ${r.propGar.map(o => `<div class="row"><div><b>${esc(o.n)}</b><div class="mut">${o.c} cuenta${o.c === 1 ? '' : 's'} · propina de cuentas ${money(o.pc)}${o.pt ? ' · propina extra tarjeta ' + money(o.pt) : ''}${o.pq ? ' · efectivo que quedó en caja ' + money(o.pq) : ''}${o.pe ? ' · efectivo directo en mano (ya la recibió) ' + money(o.pe) : ''}</div></div><b>${money(o.m)}</b></div>`).join('') || '<p class="mut" style="margin:0">Aún no hay propinas acumuladas en este turno.</p>'}
    ${r.pp ? `<div class="total"><span>Total a pagar en efectivo desde la caja</span><span>${money(r.pp)}</span></div>` : ''}
    ${r.sinGar ? `<p class="mut" style="margin:6px 0 0">Propinas de ventas sin garzón asignado (mostrador de la administradora): ${money(r.sinGar)}. No se pagan a ningún garzón.</p>` : ''}</div>`;
}
function gastosHTML(t) {
  const todos = (D.gastos || []).filter(g => g.turno_id === t.id && g.tipo !== 'Retiro' && enCorte(t, g.t, corteDe(t))), gs = todos.filter(g => !g.anul), tot = gs.reduce((a, g) => a + g.m, 0), tipo = GTIPOS.includes(S.f['g-tipo']) ? S.f['g-tipo'] : 'Boleta';
  return `<div class="card" style="margin-top:12px;display:grid;gap:8px"><b>Gastos pagados desde caja</b>
    <p class="mut" style="margin:0">Cada vez que salga dinero de la caja para pagar algo, anótalo aquí con el número de boleta o factura. Se descuenta del efectivo que debe haber y queda registrado. Si hay un error en el monto, la administradora puede corregirlo (queda el monto original) o anularlo.</p>
    <label class="mut">Documento<select id="g-tipo" data-keep>${GTIPOS.map(x => `<option ${x === tipo ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    ${tipo !== 'Sin documento' ? `<input id="g-num" data-keep inputmode="numeric" autocomplete="off" placeholder="Número de ${tipo.toLowerCase()}" value="${fv('g-num')}">` : ''}
    <input id="g-prov" data-keep autocomplete="off" placeholder="Proveedor o a quién se pagó" value="${fv('g-prov')}">
    <input id="g-det" data-keep autocomplete="off" placeholder="Detalle: qué se compró o pagó" value="${fv('g-det')}">
    <input id="g-monto" data-keep type="number" inputmode="numeric" min="1" placeholder="Monto que salió de la caja ($)" value="${fv('g-monto')}">
    <button class="btn-ok" data-act="gasto">Registrar gasto</button>
    ${todos.length ? todos.map(g => gastoFila(g, true)).join('') + `<div class="total"><span>Total gastos del turno</span><span>${money(tot)}</span></div>` : '<p class="mut" style="margin:0">Aún no hay gastos en este turno.</p>'}</div>`;
}
/* Retiros: la administradora saca efectivo de la caja durante el turno (depósito, pago personal, etc.). Se guardan como movimiento de caja tipo "Retiro" y se descuentan del efectivo esperado. */
function retirosHTML(t) {
  const lista = (D.gastos || []).filter(g => g.turno_id === t.id && g.tipo === 'Retiro' && enCorte(t, g.t, corteDe(t))), tot = lista.filter(g => !g.anul).reduce((a, g) => a + g.m, 0);
  if (!esAdm() && !lista.length) return '';
  return `<div class="card" style="margin-top:12px;display:grid;gap:8px"><b>Retiros de efectivo de la caja</b>
    <p class="mut" style="margin:0">${esAdm() ? 'Cuando saques dinero de la caja (para depositar, guardar o uso personal), anótalo aquí. Se descuenta del efectivo que debe haber, así la caja sigue cuadrando.' : 'Dinero que la administradora sacó de la caja. Ya está descontado del efectivo que debe haber.'}</p>
    ${esAdm() ? `<input id="r-monto" data-keep type="number" inputmode="numeric" min="1" placeholder="Monto retirado ($)" value="${fv('r-monto')}"><input id="r-mot" data-keep autocomplete="off" placeholder="Motivo o destino (ej.: depósito al banco)" value="${fv('r-mot')}"><button class="btn-ok" data-act="retiro">Registrar retiro</button>` : ''}
    ${lista.length ? lista.map(g => gastoFila(g, true).replace(/Retiro de efectivo/, 'Retiro')).join('') + `<div class="total"><span>Total retirado en el turno</span><span>${money(tot)}</span></div>` : '<p class="mut" style="margin:0">Aún no hay retiros en este turno.</p>'}</div>`;
}
function gastosHistHTML() {
  const g = (D.gastos || []).slice(0, 60);
  return `<div class="card" style="margin-top:12px"><b>Historial de gastos de caja</b>${g.map(x => gastoFila(x, false)).join('') || '<p class="mut" style="margin-top:8px">Aún no hay gastos registrados.</p>'}</div>`;
}
/* Vista de Caja para un garzón autorizado: cobra mesas y mostrador, abre y cierra la caja, y ve solo sus propios cobros */
function turnoCajeroHTML() {
  const t = D.turno;
  if (!t) return `<h2>Caja</h2>${abrirCajaHTML()}`;
  const mis = D.cuentas.filter(c => c.turno_id === t.id && (c.cobrado_por || '') === S.quien);
  return `<h2>Caja · ${esc(S.quien)}</h2>
  <div class="card"><b>Mis cobros de este turno</b>${mis.map(c => `<div class="row"><div>${nm(c.mesa)}<div class="mut">${hora(c.t)} · ${esc(c.metodo)}</div></div><b>${money(c.total + c.propina + c.pt)}</b></div>`).join('') || '<p class="mut" style="margin-top:8px">Aún no has cobrado en este turno.</p>'}
  ${mis.length ? `<div class="total"><span>Total cobrado por ti</span><span>${money(mis.reduce((a, c) => a + c.total + c.propina + c.pt, 0))}</span></div>` : ''}</div>${gastosHTML(t)}${retirosHTML(t)}${propinasHTML(t)}${cerrarCajaHTML(t)}`;
}
function turnoHTML() {
  if (!esAdm()) return turnoCajeroHTML();
  const t = D.turno;
  if (S.th === null) { turnoCargar().then(render); }
  const hist = (S.th || []).map(h => { const dc = h.desglose_cierre || {}; return `<div class="row"><div><b>${hora(h.abierto_at)}</b> → ${hora(h.cerrado_at)}<div class="mut">Abrió ${esc(h.abierto_por || '')} · cerró ${esc(h.cerrado_por || '')} · ${h.cuentas || 0} cuentas · ventas ${money(h.ventas_total || 0)}<br>Efectivo esperado ${money(h.esperado_efectivo || 0)} · contado ${money(h.contado_efectivo || 0)}${dc.tarjeta != null ? ' · tarjetas ' + money(dc.tarjeta) + ' · transf. ' + money(dc.transferencia || 0) : ''}${h.desglose_apertura && dnTxt(h.desglose_apertura) ? '<br>Sencillo inicial: ' + dnTxt(h.desglose_apertura) : ''}${dnTxt(dc.efectivo) ? '<br>Efectivo contado: ' + dnTxt(dc.efectivo) : ''}${h.retiro_efectivo != null ? '<br>Efectivo de ventas retirado ' + money(h.retiro_efectivo) + (dnTxt(h.desglose_deja) ? ' · quedó en caja: ' + dnTxt(h.desglose_deja) : '') : ''}${h.gastos_total ? '<br>Gastos pagados desde caja ' + money(h.gastos_total) : ''}${(h.pago_propinas || []).length ? '<br>Propinas pagadas: ' + h.pago_propinas.map(x => esc(x.n) + ' ' + money(x.m)).join(' · ') + ' (total ' + money(h.propinas_pagadas || 0) + ')' : ''}${h.nota ? '<br>' + esc(h.nota) : ''}</div></div><b style="color:${h.diferencia === 0 ? 'var(--ok)' : 'var(--bad)'}">${h.diferencia === 0 ? 'Cuadra' : (h.diferencia > 0 ? 'Sobra ' : 'Falta ') + money(Math.abs(h.diferencia || 0))}</b></div>`; }).join('') || '<p class="mut" style="margin-top:8px">Aún no hay cierres.</p>';
  if (!t) return `<h2>Caja</h2>${fondoHTML()}${abrirCajaHTML()}${gastosHistHTML()}
    <div class="card" style="margin-top:12px"><b>Cierres anteriores</b>${hist}</div>`;
  const r = turnoRes(t);
  return `<h2>Caja · turno abierto</h2>${fondoHTML()}<div class="mut" style="margin-bottom:8px">Abrió ${esc(t.abierto_por || '')} el ${hora(t.abierto_at)} con ${money(t.monto_inicial)}${dnTxt(t.desglose_apertura) ? ' (' + dnTxt(t.desglose_apertura) + ')' : ''}</div>
  <div class="stats"><div class="card stat"><span class="mut">Ventas del turno</span><b>${money(r.vt)}</b></div><div class="card stat"><span class="mut">Cuentas</span><b>${r.cuentas}</b></div><div class="card stat"><span class="mut">Propinas</span><b>${money(r.pr)}</b></div></div>
  <div class="card"><b>Cobrado por forma de pago</b><div class="row"><span>Efectivo</span><b>${money(r.ef)}</b></div><div class="row"><span>Tarjeta</span><b>${money(r.tj)}</b></div><div class="row"><span>Transferencia</span><b>${money(r.tr)}</b></div>
    ${r.gt ? `<div class="row"><span>Gastos pagados desde caja</span><b>−${money(r.gt)}</b></div>` : ''}${r.rt ? `<div class="row"><span>Retiros de la administradora</span><b>−${money(r.rt)}</b></div>` : ''}${r.pp ? `<div class="row"><span>Propinas pagadas a garzones</span><b>−${money(r.pp)}</b></div>` : ''}<div class="total"><span>Efectivo que debe haber en caja</span><span>${money(r.esp)}</span></div><p class="mut">Incluye el efectivo inicial y descuenta gastos, retiros y propinas pagadas. No incluye la propina en efectivo entregada directo al garzón.</p></div>
  ${cobrosHTML(t)}
  <div class="card" style="margin-top:12px"><b>Quién estuvo en caja</b>${cajerosHTML(t)}</div>
  ${gastosHTML(t)}${retirosHTML(t)}${descuentosHTML(t)}${propinasHTML(t)}${cerrarCajaHTML(t)}${gastosHistHTML()}
  <div class="card" style="margin-top:12px"><b>Cierres anteriores</b>${hist}</div>`;
}
/* ---------- Inventario de producción: lo que se compra para producir (mermeladas, tarros de duraznos, cremas…). Aparte de la carta. ---------- */
const UNIDADES = [['un', 'unidades'], ['kg', 'kilos'], ['g', 'gramos'], ['lt', 'litros'], ['ml', 'mililitros'], ['tarro', 'tarros'], ['caja', 'cajas'], ['bolsa', 'bolsas'], ['paquete', 'paquetes']];
const unTxt = u => (UNIDADES.find(x => x[0] === u) || [0, u])[1];
const fmtQ = n => (Math.round(n * 100) / 100).toLocaleString('es-CL');
/* ---------- Registro de cambios (quién cambió qué y cuándo) ---------- */
const BIT_TABLA = { resto_menu: 'Carta', resto_garzones: 'Garzón', resto_cocineras: 'Cocinera', resto_locales: 'Local', resto_insumos: 'Inventario de producción', resto_turnos: 'Caja', resto_gastos: 'Gasto de caja', resto_cuentas: 'Cobro' };
const BIT_ACC = { INSERT: 'agregó', UPDATE: 'cambió', DELETE: 'eliminó' };
const BIT_CAMPO = { nombre: 'nombre', categoria: 'sección', precio: 'precio', activo: 'activo', estacion: 'se prepara en', codigo: 'código', stock_min: 'mínimo', mesas: 'mesas (piso 1)', mesas2: 'mesas (piso 2)', fondo_caja: 'sencillo fijo', qr_activo: 'pedido por QR', pin: 'PIN', caja: 'cobra en caja', unidad: 'unidad', costo_unit: 'costo unitario', monto: 'monto', monto_original: 'monto original', metodo: 'forma de pago', metodo_original: 'forma de pago original', metodo_editado_por: 'corregido por', metodo_editado_motivo: 'motivo de la corrección', metodo_editado_at: 'corregido', propina_tarj: 'propina extra tarjeta', editado_por: 'corregido por', editado_at: 'corregido', editado_motivo: 'motivo de la corrección', anulado: 'anulado', anulado_por: 'anulado por', anulado_motivo: 'motivo', anul_pedida_por: 'anulación pedida por', anul_pedida_motivo: 'motivo pedido', tipo: 'documento', numero: 'número', proveedor: 'proveedor', detalle: 'detalle', cerrado_at: 'cerrado', cerrado_por: 'cerrado por', abierto_por: 'abierto por', monto_inicial: 'sencillo inicial', contado_efectivo: 'efectivo contado', diferencia: 'diferencia', esperado_efectivo: 'efectivo esperado' };
const bitVal = (k, v) => v === null || v === undefined ? '—' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : ['precio', 'monto', 'monto_original', 'fondo_caja', 'monto_inicial', 'contado_efectivo', 'diferencia', 'esperado_efectivo', 'costo_unit'].includes(k) && typeof v === 'number' ? money(v) : String(v).length > 60 ? String(v).slice(0, 60) + '…' : String(v);
async function cargarBit() {
  S.bitCarg = true;
  const r = await sb.from('resto_bitacora').select('*').eq('local_id', D.id).order('at', { ascending: false }).limit(300);
  S.bit = r.error ? [] : (r.data || []); S.bitErr = r.error ? r.error.message : '';
  render();
}
function bitHTML() {
  if (S.bit == null) { if (!S.bitCarg) cargarBit(); return '<h2>Registro de cambios</h2><p class="mut">Cargando…</p>'; }
  const ft = S.f['bit-t'] || '', lista = S.bit.filter(b => !ft || b.tabla === ft);
  const fila = b => {
    const d = b.detalle || {}, upd = b.accion === 'UPDATE';
    const det = upd ? Object.keys(d).map(k => esc(BIT_CAMPO[k] || k) + ': <b>' + esc(bitVal(k, d[k] && d[k].antes)) + '</b> → <b>' + esc(bitVal(k, d[k] && d[k].despues)) + '</b>').join(' · ')
      : Object.keys(d).filter(k => d[k] !== null && d[k] !== '').slice(0, 6).map(k => esc(BIT_CAMPO[k] || k) + ': ' + esc(bitVal(k, d[k]))).join(' · ');
    return `<div class="row" style="align-items:flex-start"><div><b>${esc(b.quien || 'sin identificar')}</b>${b.rol ? ' <small class="mut">(' + esc(b.rol === 'admin' ? 'administradora' : b.rol) + ')</small>' : ''} ${BIT_ACC[b.accion] || ''} <b>${esc(BIT_TABLA[b.tabla] || b.tabla)}</b>${b.fila ? ': ' + esc(b.fila) : ''}<div class="mut">${det}</div></div><small class="mut" style="white-space:nowrap">${esc(new Date(b.at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small></div>`;
  };
  return `<h2>Registro de cambios</h2><div class="card"><p class="mut" style="margin-bottom:8px">Aquí queda quién cambió precios, carta, garzones, PIN, caja, gastos e inventario de producción, y cuándo. No se puede editar ni borrar.</p>
    <select id="bit-t" data-keep style="margin-bottom:8px"><option value="">Todo</option>${Object.keys(BIT_TABLA).map(t => `<option value="${t}" ${ft === t ? 'selected' : ''}>${BIT_TABLA[t]}</option>`).join('')}</select>
    ${S.bitErr ? '<p class="mut" style="color:var(--bad)">Falta ejecutar la migración del registro de cambios.</p>' : ''}
    ${lista.map(fila).join('') || '<p class="mut">Aún no hay cambios registrados.</p>'}</div>`;
}
const numD = k => { const v = String(S.f[k] ?? '').replace(',', '.').trim(); return v !== '' && !isNaN(+v) ? +v : null; };
const bajoIns = () => ((D && D.insumos) || []).filter(i => i.on && i.s <= i.sm);
const MOTIVO = { compra: 'Compra', uso: 'Uso', merma: 'Merma', conteo: 'Conteo' };
function insumosHTML() {
  const ins = D.insumos.filter(i => i.on), bajos = bajoIns(), valor = ins.reduce((a, i) => a + (i.cu != null ? i.cu * i.s : 0), 0);
  const nm2 = id => (D.insumos.find(i => i.id === id) || {}).n || 'Insumo';
  const un2 = id => (D.insumos.find(i => i.id === id) || {}).u || 'un';
  const tipo = GTIPOS.includes(S.f['c-tipo']) ? S.f['c-tipo'] : 'Boleta';
  return `<h2>Inventario de producción</h2>
  <p class="mut" style="margin:-6px 0 12px">Aquí van los insumos que compras para producir lo que vendes: mermeladas, tarros de duraznos, cremas, harinas, etc. Es aparte de la carta, que solo tiene los productos de venta.</p>
  ${D.insErr ? '<div class="card" style="color:var(--bad);margin-bottom:12px">No se pudo leer el inventario de producción. Falta ejecutar la migración resto_migracion_insumos.sql en Supabase.</div>' : ''}
  ${bajos.length ? `<div class="card" style="margin-bottom:12px;border:2px solid var(--warn)"><b>Hay que comprar</b>${bajos.map(i => `<div class="row"><span>${esc(i.n)}</span><b style="color:var(--bad)">${fmtQ(i.s)} ${esc(unTxt(i.u))}</b></div>`).join('')}</div>` : ''}
  <div class="stats"><div class="card stat"><span class="mut">Insumos</span><b>${ins.length}</b></div><div class="card stat"><span class="mut">Por comprar</span><b>${bajos.length}</b></div><div class="card stat"><span class="mut">Valor en bodega</span><b>${money(valor)}</b></div></div>
  <div class="cols2" style="margin-top:12px"><div style="display:grid;gap:12px;align-self:start">
    <div class="card" style="display:grid;gap:8px"><b>Agregar insumo</b>
      <input id="i-n" data-keep autocomplete="off" placeholder="Nombre (ej. Mermelada de frambuesa)" value="${fv('i-n')}">
      <label class="mut">Se mide en<select id="i-u" data-keep>${UNIDADES.map(([k, n]) => `<option value="${k}" ${(S.f['i-u'] || 'un') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <input id="i-s" data-keep inputmode="decimal" placeholder="Cantidad que tienes ahora (opcional)" value="${fv('i-s')}">
      <input id="i-min" data-keep inputmode="decimal" placeholder="Avisar cuando quede (opcional)" value="${fv('i-min')}">
      <button class="btn-ok" data-act="insadd">Agregar insumo</button></div>
    <div class="card" style="display:grid;gap:8px"><b>Registrar compra</b>
      <label class="mut">Insumo<select id="c-ins" data-keep><option value="">Elige el insumo…</option>${ins.map(i => `<option value="${i.id}" ${S.f['c-ins'] === i.id ? 'selected' : ''}>${esc(i.n)} (${esc(unTxt(i.u))})</option>`).join('')}</select></label>
      <input id="c-q" data-keep inputmode="decimal" placeholder="Cantidad comprada" value="${fv('c-q')}">
      <input id="c-m" data-keep type="number" inputmode="numeric" min="1" placeholder="Total pagado ($)" value="${fv('c-m')}">
      <label class="mut">Documento<select id="c-tipo" data-keep>${GTIPOS.map(x => `<option ${x === tipo ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      ${tipo !== 'Sin documento' ? `<input id="c-num" data-keep inputmode="numeric" autocomplete="off" placeholder="Número de ${tipo.toLowerCase()}" value="${fv('c-num')}">` : ''}
      <input id="c-prov" data-keep autocomplete="off" placeholder="Proveedor" value="${fv('c-prov')}">
      <label class="mut">Se pagó con<select id="c-pago" data-keep><option value="otro" ${S.f['c-pago'] !== 'caja' ? 'selected' : ''}>Otro medio (no sale de la caja)</option><option value="caja" ${S.f['c-pago'] === 'caja' ? 'selected' : ''}>Dinero de la caja${D.turno ? '' : ' (la caja está cerrada)'}</option></select></label>
      ${S.f['c-pago'] === 'caja' ? '<p class="mut" style="margin:0">También quedará anotado como gasto de la caja, con su boleta o factura.</p>' : ''}
      <button class="btn-ok" data-act="inscompra">Registrar compra</button></div></div>
  <div style="display:grid;gap:12px"><div class="card"><b>Insumos</b><p class="mut" style="margin:4px 0 6px">Escribe una cantidad y usa "Usó" cuando se gasta en producción, "Merma" si se pierde o vence, y "Contar" para fijar lo que realmente hay.</p>
    ${buscaHTML('q-prod', 'Buscar insumo…')}${filtra(ins, 'q-prod').map(i => `<div class="row"><div>${esc(i.n)}<div class="mut">Hay <b style="color:${i.s <= i.sm ? 'var(--bad)' : 'inherit'}">${fmtQ(i.s)} ${esc(unTxt(i.u))}</b>${i.sm ? ' · avisar en ' + fmtQ(i.sm) : ''}${i.cu != null ? ' · última compra ' + money(i.cu) + ' por ' + esc(i.u) : ''}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><input id="iq-${i.id}" data-keep inputmode="decimal" placeholder="Cant." style="width:80px" value="${fv('iq-' + i.id)}"><button class="btn-line" data-act="insuso" data-id="${i.id}">Usó</button><button class="btn-line" data-act="insmerma" data-id="${i.id}">Merma</button><button class="btn-line" data-act="inscont" data-id="${i.id}">Contar</button><button class="btn-line" data-act="insmin" data-id="${i.id}">Mín.</button><button class="btn-bad" data-act="insoff" data-id="${i.id}">Quitar</button></div></div>`).join('') || '<p class="mut" style="margin-top:8px">Aún no hay insumos. Agrega el primero.</p>'}</div>
    <div class="card"><b>Movimientos</b>${D.insmov.slice(0, 60).map(m => `<div class="row"><div>${esc(nm2(m.iid))} · <b>${MOTIVO[m.mo] || esc(m.mo)}</b><div class="mut">${hora(m.t)} · ${esc(m.por)}${m.td ? ' · ' + esc(m.td) + (m.nd ? ' N° ' + esc(m.nd) : '') : ''}${m.pv ? ' · ' + esc(m.pv) : ''}${m.caja ? ' · pagado desde caja' : ''}${m.nota ? ' · ' + esc(m.nota) : ''}</div></div><div style="text-align:right"><b style="color:${m.d < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.d > 0 ? '+' : ''}${fmtQ(m.d)} ${esc(unTxt(un2(m.iid)))}</b>${m.ct ? '<div class="mut">' + money(m.ct) + '</div>' : ''}</div></div>`).join('') || '<p class="mut" style="margin-top:8px">Aún no hay movimientos.</p>'}</div></div></div>`;
}

/* ---- Compras y recetas: recetas con descuento automático, proveedores, órdenes de compra, vencimientos, conteo guiado ---- */
const diasPara = f => f ? Math.round((new Date(f + 'T12:00:00') - new Date(hoyIso() + 'T12:00:00')) / 86400000) : null;
const vencen = () => ((D && D.insumos) || []).filter(i => i.on && i.v && diasPara(i.v) <= 7 && i.s > 0);
const sugerido = i => Math.max(1, Math.ceil((i.sm || 1) * 2 - i.s));
function ocTexto(o) { return 'Pedido de compra · ' + (D.name || '') + '\n' + o.items.map(x => '• ' + x.q + ' ' + x.u + ' de ' + x.n).join('\n') + (o.nota ? '\n' + o.nota : '') + '\nGracias.'; }
function abastHTML() {
  const ins = D.insumos.filter(i => i.on), menu = D.menu, bajos = bajoIns(), ven = vencen();
  const nmI = id => (D.insumos.find(i => i.id === id) || {}).n || 'Insumo', unI = id => unTxt((D.insumos.find(i => i.id === id) || {}).u || 'un');
  const conRec = menu.filter(m => D.recetas.some(r => r.m === m.id));
  const oc = o => { const pv = D.provs.find(p => p.n === o.pv) || {}, tx = encodeURIComponent(ocTexto(o)), tel = String(pv.tel || '').replace(/\D/g, '');
    return `<div class="row" style="align-items:flex-start"><div><b>${esc(o.pv)}</b> · <span class="pill">${o.est}</span><div class="mut">${hora(o.t)} · ${o.items.map(x => esc(x.q + ' ' + x.u + ' ' + x.n)).join(', ')}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${o.est === 'pendiente' ? `${tel ? `<a class="btn-line" target="_blank" rel="noopener" href="https://wa.me/${tel}?text=${tx}">WhatsApp</a>` : ''}${pv.mail ? `<a class="btn-line" href="mailto:${esc(pv.mail)}?subject=${encodeURIComponent('Pedido de compra · ' + (D.name || ''))}&body=${tx}">Correo</a>` : ''}<button class="btn-ok" data-act="ocrec" data-id="${o.id}">Recibida</button><button class="btn-line" data-act="ocanu" data-id="${o.id}">Anular</button>` : ''}</div></div>`; };
  return `<h2>Compras y recetas</h2>
  ${ven.length ? `<div class="card" style="margin-bottom:12px;border:2px solid var(--bad)"><b>Por vencer o vencidos</b>${ven.map(i => `<div class="row"><span>${esc(i.n)} · ${fmtQ(i.s)} ${esc(unTxt(i.u))}</span><b style="color:var(--bad)">${diasPara(i.v) < 0 ? 'vencido hace ' + (-diasPara(i.v)) + ' d' : diasPara(i.v) === 0 ? 'vence hoy' : 'vence en ' + diasPara(i.v) + ' d'}</b></div>`).join('')}</div>` : ''}
  <div class="cols2"><div style="display:grid;gap:12px;align-self:start">
    <div class="card" style="display:grid;gap:8px"><b>Orden de compra</b>
      ${bajos.length ? `<p class="mut" style="margin:0">Con lo que está bajo el mínimo: ${bajos.map(i => esc(i.n)).join(', ')}.</p>` : '<p class="mut" style="margin:0">No hay insumos bajo el mínimo. Igual puedes armar una orden.</p>'}
      <label class="mut">Proveedor<select id="oc-pv" data-keep><option value="">Elige proveedor…</option>${D.provs.map(p => `<option ${S.f['oc-pv'] === p.n ? 'selected' : ''}>${esc(p.n)}</option>`).join('')}</select></label>
      <button class="btn-ok" data-act="ocnueva" ${bajos.length ? '' : 'disabled'}>Crear orden con lo que falta</button>
      ${D.ocs.length ? D.ocs.slice(0, 15).map(oc).join('') : ''}</div>
    <div class="card" style="display:grid;gap:8px"><b>Proveedores</b>
      <input id="pv-n" data-keep autocomplete="off" placeholder="Nombre del proveedor" value="${fv('pv-n')}">
      <input id="pv-t" data-keep inputmode="tel" placeholder="Teléfono (con 56…) para WhatsApp" value="${fv('pv-t')}">
      <input id="pv-m" data-keep type="email" placeholder="Correo (opcional)" value="${fv('pv-m')}">
      <button class="btn-ok" data-act="pvadd">Agregar proveedor</button>
      ${D.provs.map(p => `<div class="row"><div>${esc(p.n)}<div class="mut">${esc(p.tel)}${p.mail ? ' · ' + esc(p.mail) : ''}</div></div><button class="btn-bad" data-act="pvdel" data-id="${p.id}">Quitar</button></div>`).join('')}</div>
    <div class="card" style="display:grid;gap:8px"><b>Receta de un producto</b><p class="mut" style="margin:0">Cada vez que se venda el producto se descuenta solo lo que gasta de cada insumo.</p>
      <label class="mut">Producto<select id="r-m" data-keep><option value="">Elige el producto…</option>${menu.map(m => `<option value="${m.id}" ${S.f['r-m'] === m.id ? 'selected' : ''}>${esc(m.n)}</option>`).join('')}</select></label>
      <label class="mut">Insumo<select id="r-i" data-keep><option value="">Elige el insumo…</option>${ins.map(i => `<option value="${i.id}" ${S.f['r-i'] === i.id ? 'selected' : ''}>${esc(i.n)} (${esc(unTxt(i.u))})</option>`).join('')}</select></label>
      <input id="r-q" data-keep inputmode="decimal" placeholder="Cantidad por cada unidad vendida" value="${fv('r-q')}">
      <button class="btn-ok" data-act="recadd">Agregar a la receta</button>
      ${conRec.map(m => `<div style="border-top:1px solid var(--line,#ddd);padding-top:6px"><b>${esc(m.n)}</b>${D.recetas.filter(r => r.m === m.id).map(r => `<div class="row"><span>${fmtQ(r.q)} ${esc(unI(r.i))} de ${esc(nmI(r.i))}</span><button class="btn-line" data-act="recdel" data-id="${r.id}">Quitar</button></div>`).join('')}</div>`).join('')}</div></div>
  <div style="display:grid;gap:12px"><div class="card"><b>Conteo físico guiado</b><p class="mut" style="margin:4px 0 6px">Recorre la bodega y escribe lo que realmente hay. Los insumos que dejes en blanco no se tocan. Al aplicar, el sistema ajusta las diferencias y las deja registradas.</p>
    ${ins.map(i => `<div class="row"><div>${esc(i.n)}<div class="mut">Sistema: ${fmtQ(i.s)} ${esc(unTxt(i.u))}${i.v ? ' · vence ' + esc(i.v) : ''}</div></div><div style="display:flex;gap:6px;align-items:center"><input id="cg-${i.id}" data-keep inputmode="decimal" placeholder="Hay…" style="width:84px" value="${fv('cg-' + i.id)}"><button class="btn-line" data-act="insvence" data-id="${i.id}" title="Fecha de vencimiento">Vence</button></div></div>`).join('') || '<p class="mut">Sin insumos.</p>'}
    ${ins.length ? '<button class="btn-ok" style="margin-top:8px;width:100%" data-act="cgapl">Aplicar conteo</button>' : ''}</div></div></div>`;
}

/* ---- Resumen del dueño: períodos, comparación con el período anterior, Excel, PDF, respaldo y envío ---- */
const RSP = { hoy: 'Hoy', ayer: 'Ayer', '7': 'Últimos 7 días', '30': 'Últimos 30 días', mes: 'Este mes' };
function rsRango(p) {
  const a = new Date(); a.setHours(0, 0, 0, 0); let d0 = new Date(a), d1 = new Date(a); d1.setDate(d1.getDate() + 1);
  if (p === 'ayer') { d0.setDate(d0.getDate() - 1); d1 = new Date(a); }
  else if (p === '7') d0.setDate(d0.getDate() - 6);
  else if (p === '30') d0.setDate(d0.getDate() - 29);
  else if (p === 'mes') d0.setDate(1);
  const ms = d1 - d0, p1 = new Date(d0), p0 = new Date(+d0 - ms);
  return { d0, d1, p0, p1 };
}
async function rsTraer(d0, d1) {
  const q = (t, extra) => sb.from(t).select('*').eq('local_id', D.id).gte('created_at', d0.toISOString()).lt('created_at', d1.toISOString()).order('created_at').limit(20000);
  const [cu, ga, im] = await Promise.all([q('resto_cuentas'), q('resto_gastos'), q('resto_insumo_mov')]);
  if (cu.error) throw new Error(cu.error.message);
  return { cu: cu.data || [], ga: (ga.data) || [], im: ((im.data) || []).filter(m => m.motivo === 'compra' && !m.pagado_caja) };
}
function rsAgg(x) {
  const venta = x.cu.reduce((a, c) => a + (+c.total || 0), 0), prop = x.cu.reduce((a, c) => a + (+c.propina || 0) + (+c.propina_efec || 0) + (+c.propina_tarj || 0), 0),
    desc = x.cu.reduce((a, c) => a + (+c.descuento || 0), 0), gasto = x.ga.reduce((a, g) => a + (+g.monto || 0), 0) + x.im.reduce((a, m) => a + (+m.costo_total || 0), 0);
  const pop = {}, pg = {}, mp = {};
  x.cu.forEach(c => { (c.items || []).forEach(i => { pop[i.n] = (pop[i.n] || 0) + (+i.q || 0); }); const g = c.garzon || '(sin garzón)'; pg[g] = (pg[g] || 0) + (+c.total || 0); mp[c.metodo || '—'] = (mp[c.metodo || '—'] || 0) + (+c.total || 0); });
  return { venta, prop, desc, gasto, n: x.cu.length, tk: x.cu.length ? Math.round(venta / x.cu.length) : 0, util: venta - gasto, pop, pg, mp };
}
async function rsCargar() {
  const p = S.rsp || 'hoy', r = rsRango(p); S.rs = 'cargando'; render();
  try { const [c, a] = await Promise.all([rsTraer(r.d0, r.d1), rsTraer(r.p0, r.p1)]); S.rs = { p, cur: c, ant: a, A: rsAgg(c), B: rsAgg(a), t: Date.now() }; }
  catch (e) { S.rs = { err: e.message }; }
  render();
}
const rsVar = (a, b) => b ? ((a - b) / b * 100) : null;
const rsVarTxt = (a, b, malo) => { const v = rsVar(a, b); if (v === null) return a ? '<span class="mut">nuevo</span>' : ''; const up = v >= 0, bien = malo ? !up : up; return `<span style="color:${bien ? 'var(--ok)' : 'var(--bad)'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(v))}%</span>`; };
function rsTexto() {
  const r = S.rs, A = r.A, B = r.B, top = Object.entries(A.pop).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const v = (a, b) => { const x = rsVar(a, b); return x === null ? '' : ' (' + (x >= 0 ? '+' : '') + Math.round(x) + '% vs período anterior)'; };
  return 'Resumen · ' + (D.name || '') + ' · ' + RSP[r.p] + '\nVentas: ' + money(A.venta) + v(A.venta, B.venta) + '\nCuentas: ' + A.n + ' · Ticket promedio: ' + money(A.tk) + '\nPropinas: ' + money(A.prop) + '\nDescuentos: ' + money(A.desc) + '\nGastos y compras: ' + money(A.gasto) + '\nResultado aprox.: ' + money(A.util) + (top.length ? '\nMás vendidos: ' + top.map(([k, q]) => k + ' (' + q + ')').join(', ') : '');
}
function rsExcel() {
  const r = S.rs, q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const t = '﻿Fecha;Mesa;Garzón;Método;Venta;Descuento;Propina;Detalle\n' + r.cur.cu.map(c => [new Date(c.created_at).toLocaleString('es-CL'), q(nm(+c.mesa)), q(c.garzon), q(c.metodo), c.total, c.descuento || 0, (+c.propina || 0) + (+c.propina_efec || 0) + (+c.propina_tarj || 0), q((c.items || []).map(i => i.q + '× ' + i.n).join(', '))].join(';')).join('\n');
  bajar(t, 'text/csv;charset=utf-8', 'ventas_' + (D.name || 'local').replace(/\W+/g, '_') + '_' + r.p + '.csv');
}
function bajar(txt, tipo, nombre) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: tipo })); a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); }
async function respaldo() {
  const tablas = ['resto_locales', 'resto_menu', 'resto_garzones', 'resto_cocineras', 'resto_insumos', 'resto_recetas', 'resto_proveedores', 'resto_ordenes_compra', 'resto_cuentas', 'resto_gastos', 'resto_insumo_mov', 'resto_turnos'];
  const out = { local: D.name, fecha: new Date().toISOString(), version: 1, tablas: {} };
  for (const t of tablas) {
    const r = await sb.from(t).select('*').eq(t === 'resto_locales' ? 'id' : 'local_id', D.id).limit(50000);
    if (r.error) { out.tablas[t] = { error: r.error.message }; continue; }
    out.tablas[t] = (r.data || []).map(x => { const y = { ...x }; delete y.pin; delete y.admin_pin; delete y.pin_hash; return y; });
  }
  bajar(JSON.stringify(out, null, 1), 'application/json', 'respaldo_' + (D.name || 'local').replace(/\W+/g, '_') + '_' + fechaIso(new Date()) + '.json');
}
function resumenHTML() {
  const r = S.rs, p = S.rsp || 'hoy';
  const bar = `<div class="noimp" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${Object.entries(RSP).map(([k, n]) => `<button class="${p === k ? 'btn' : 'btn-line'}" data-act="rsp" data-p="${k}">${n}</button>`).join('')}</div>`;
  const resp = `<div class="card noimp" style="margin-top:12px"><b>Respaldo</b><p class="mut" style="margin:4px 0 8px">Descarga una copia de toda la información del local (carta, cuentas, gastos, inventario). Guárdala en tu computador o en tu correo. No incluye los PIN.</p><button class="btn-line" data-act="respaldo">Descargar respaldo</button></div>`;
  if (!r || r === 'cargando') return `<h2>Resumen del dueño</h2>${bar}<p class="mut">${r === 'cargando' ? 'Cargando…' : 'Elige un período.'}</p>${resp}`;
  if (r.err) return `<h2>Resumen del dueño</h2>${bar}<div class="card" style="color:var(--bad)">No se pudo cargar: ${esc(r.err)}</div>${resp}`;
  const A = r.A, B = r.B, top = Object.entries(A.pop).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const st = (t, a, b, f, malo) => `<div class="card stat"><span class="mut">${t}</span><b>${f(a)}</b><small>${rsVarTxt(a, b, malo)}</small></div>`;
  const lista = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('') || '<p class="mut">Sin datos.</p>';
  return `<h2>Resumen del dueño · ${RSP[r.p]}</h2>${bar}
  <div class="stats">${st('Ventas', A.venta, B.venta, money)}${st('Cuentas', A.n, B.n, x => x)}${st('Ticket promedio', A.tk, B.tk, money)}${st('Propinas', A.prop, B.prop, money)}${st('Descuentos', A.desc, B.desc, money, true)}${st('Gastos y compras', A.gasto, B.gasto, money, true)}${st('Resultado aprox.', A.util, B.util, money)}</div>
  <p class="mut" style="margin:6px 0">Las flechas comparan con el período anterior de igual duración. El resultado es ventas menos gastos de caja y compras de insumos; no incluye sueldos ni arriendo.</p>
  <div class="cols"><div class="card"><b>Más vendidos</b>${top.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<p class="mut">Sin datos.</p>'}</div>
  <div class="card"><b>Por forma de pago</b>${lista(A.mp)}<b style="display:block;margin-top:12px">Por garzón</b>${lista(A.pg)}</div></div>
  <div class="card noimp" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn-line" data-act="rsxls">Descargar Excel</button><button class="btn-line" data-act="rspdf">Imprimir / guardar PDF</button><button class="btn-line" data-act="rswa">Enviar por WhatsApp</button><a class="btn-line" href="mailto:?subject=${encodeURIComponent('Resumen · ' + (D.name || ''))}&body=${encodeURIComponent(rsTexto())}">Enviar por correo</a></div>${resp}`;
}
function invHTML() {
  const l = L(), bajos = bajoStock();
  const nuevo = S.nuevo ? `<div class="card" style="margin-bottom:12px;display:grid;gap:8px;border:2px solid var(--warn)"><b>Código nuevo: ${esc(S.nuevo.cb)}</b>
    <p class="mut">Ese código no está en tu carta. Completa los datos para crear el producto y registrar su primera entrada.</p>
    <input id="nn" data-keep placeholder="Nombre del producto" value="${fv('nn')}">
    <input id="nc" data-keep placeholder="Categoría (Bebidas, Pasteles…)" list="cl2" value="${fv('nc')}"><datalist id="cl2">${[...new Set(l.menu.map(i => i.c))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <input id="np" data-keep type="number" inputmode="numeric" min="0" placeholder="Precio de venta" value="${fv('np')}">
    <input id="nq" data-keep type="number" inputmode="numeric" min="0" placeholder="Cantidad que ingresa" value="${fv('nq')}">
    <label class="mut">Se prepara en<select id="ne" data-keep><option value="cocina" ${S.f.ne !== 'cafeteria' ? 'selected' : ''}>Cocina</option><option value="cafeteria" ${S.f.ne === 'cafeteria' ? 'selected' : ''}>Cafetería</option></select></label>
    <div style="display:flex;gap:8px"><button class="btn-ok" data-act="crearcb">Crear y registrar entrada</button><button class="btn-line" data-act="cancelcb">Cancelar</button></div></div>` : '';
  const bajosF = filtra(bajos, 'q-inv');
  return `<h2>Inventario</h2>${buscaHTML('q-inv', 'Buscar producto en el inventario…')}${bajosF.length ? `<div class="card" style="margin-bottom:12px;border:2px solid var(--warn)"><b>Stock bajo o agotado</b><p class="mut" style="margin:2px 0 4px">Escribe la cantidad que ingresa y toca "+ Entrada" para sumarla al stock.</p>${bajosF.map(i => `<div class="row"><div>${esc(i.n)}<div class="mut">Stock <b style="color:var(--bad)">${i.s}</b>${i.sm ? ' · mínimo ' + i.sm : ''}</div></div><div style="display:flex;gap:6px;align-items:center"><input id="sqb-${i.id}" data-keep type="number" inputmode="numeric" min="1" placeholder="Cant." aria-label="Cantidad que ingresa" style="width:80px" value="${fv('sqb-' + i.id)}"><button class="btn-ok" data-act="sk_add" data-src="sqb" data-id="${i.id}">+ Entrada</button></div></div>`).join('')}</div>` : ''}
  <div class="card" style="margin-bottom:12px;display:grid;gap:8px"><b>Ingreso por código de barras</b>
    <p class="mut">Haz clic en el campo y escanea cada producto: se suma a su stock. Si el código no existe, te pide crear el producto. Cambia la cantidad para ingresar de a varias unidades.</p>
    <div style="display:flex;gap:8px"><input id="scan-inv" autocomplete="off" placeholder="Escanear código de barras…" style="flex:1"><input id="scan-q" data-keep type="number" inputmode="numeric" min="1" placeholder="Cant." style="width:80px" value="${S.f['scan-q'] === undefined ? 1 : fv('scan-q')}"></div></div>
  ${nuevo}
  <div class="card"><p class="mut" style="margin-bottom:6px">Escribe una cantidad y usa "Controlar" para empezar a llevar el stock de un producto. Cada venta lo descuenta sola. "Entrada" suma mercadería; "Contar" fija el stock real; "Mín." fija el aviso de stock bajo. El código de barras se escanea directo en el campo de cada producto.</p>
  ${filtra([...l.menu].sort(porNombre), 'q-inv').map(i => `<div class="row"><div>${esc(i.n)}<div class="mut">${esc(i.c)} · ${i.s == null ? 'sin control de stock' : 'stock <b>' + i.s + '</b>' + (i.sm ? ' · mínimo ' + i.sm : '')}${i.cb ? ' · código ' + esc(i.cb) : ''}</div></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><input id="pr-${i.id}" data-keep type="number" inputmode="numeric" min="1" placeholder="Precio" style="width:90px" value="${S.f['pr-' + i.id] === undefined ? i.p : fv('pr-' + i.id)}"><button class="btn-line" data-act="pr_set" data-id="${i.id}">Cambiar precio</button><input id="cb-${i.id}" data-keep autocomplete="off" placeholder="Código de barras" style="width:150px" value="${S.f['cb-' + i.id] === undefined ? esc(i.cb) : fv('cb-' + i.id)}"><button class="btn-line" data-act="cb_set" data-id="${i.id}">Guardar código</button>
    <input id="sq-${i.id}" data-keep type="number" inputmode="numeric" placeholder="Cant." style="width:80px" value="${fv('sq-' + i.id)}">
    ${i.s == null ? `<button class="btn" data-act="sk_set" data-id="${i.id}">Controlar</button>` : `<button class="btn-ok" data-act="sk_add" data-id="${i.id}">+ Entrada</button><button class="btn-line" data-act="sk_set" data-id="${i.id}">Contar</button><button class="btn-line" data-act="sk_min" data-id="${i.id}">Mín.</button><button class="btn-bad" data-act="sk_off" data-id="${i.id}">Quitar</button>`}</div></div>`).join('') || '<p class="mut">Sin productos.</p>'}</div>`;
}
function resvHTML() {
  const l = L(), hoyS = hoyIso();
  const mesasOpt = ['<option value="">Sin asignar</option>'];
  for (let n = 1; n <= l.mesas; n++) mesasOpt.push(`<option value="${n}" ${String(S.f.rm) === String(n) ? 'selected' : ''}>${nm(n)}</option>`);
  for (let k = 1; k <= l.mesas2; k++) mesasOpt.push(`<option value="${100 + k}" ${String(S.f.rm) === String(100 + k) ? 'selected' : ''}>${nm(100 + k)}</option>`);
  const pend = l.reservas.filter(r => r.estado === 'pendiente'), dias = [...new Set(pend.map(r => r.fecha))];
  const ahora = new Date().toTimeString().slice(0, 5);
  return `<h2>Reservas</h2><div class="cols"><div>${dias.map(d => `<div class="piso">${d === hoyS ? 'Hoy' : new Date(d + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</div><div class="card">${pend.filter(r => r.fecha === d).map(r => `<div class="row"><div><b>${esc(r.hora)}</b> · ${esc(r.nombre)} · ${r.personas} pers.${d === hoyS && r.hora < ahora ? ' <span class="pill" style="background:#fee2e2;color:var(--bad)">atrasada</span>' : ''}<div class="mut">${r.mesa ? nm(r.mesa) : 'Sin mesa asignada'}${r.telefono ? ' · ' + esc(r.telefono) : ''}${r.nota ? ' · ' + esc(r.nota) : ''}</div></div><div style="display:flex;gap:6px"><button class="btn-ok" data-act="rllego" data-id="${r.id}">Llegó</button><button class="btn-bad" data-act="rcancel" data-id="${r.id}">Cancelar</button></div></div>`).join('')}</div>`).join('') || '<p class="mut">No hay reservas pendientes.</p>'}</div>
  <div class="card" style="display:grid;gap:8px;align-self:start"><b>Nueva reserva</b>
    <label class="mut">Fecha<input id="rf" data-keep type="date" value="${S.f.rf || hoyS}" min="${hoyS}"></label>
    <label class="mut">Hora<input id="rh" data-keep type="time" value="${fv('rh')}"></label>
    <label class="mut">Personas<input id="rp" data-keep type="number" inputmode="numeric" min="1" value="${S.f.rp || 2}"></label>
    <input id="rn" data-keep placeholder="Nombre" value="${fv('rn')}"><input id="rt" data-keep type="tel" inputmode="tel" placeholder="Teléfono" value="${fv('rt')}">
    <label class="mut">Mesa<select id="rm" data-keep>${mesasOpt.join('')}</select></label>
    <input id="rnota" data-keep placeholder="Nota (cumpleaños, terraza…)" value="${fv('rnota')}"><button class="btn" data-act="rcrear">Guardar reserva</button></div></div>`;
}
function cajaHTML() {
  const cu = L().cuentas.filter(c => hoy(c.t)); const sum = k => cu.reduce((a, c) => a + c[k], 0);
  const por = {}; cu.forEach(c => por[c.metodo] = (por[c.metodo] || 0) + c.total + c.propina + c.pt);
  const pop = {}; cu.forEach(c => c.items.forEach(i => pop[i.n] = (pop[i.n] || 0) + i.q));
  const top = Object.entries(pop).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `<h2>Ventas de hoy</h2><div class="stats">
    <div class="card stat"><span class="mut">Ventas</span><b>${money(sum('total'))}</b></div>
    <div class="card stat"><span class="mut">Propinas (10% + efectivo + tarjeta)</span><b>${money(sum('propina') + sum('pe') + sum('pt'))}</b></div>
    <div class="card stat"><span class="mut">Cuentas cerradas</span><b>${cu.length}</b></div>
    <div class="card stat"><span class="mut">Ticket promedio</span><b>${money(cu.length ? sum('total') / cu.length : 0)}</b></div></div>
  <div class="cols"><div class="card"><b>Por forma de pago</b>${Object.entries(por).map(([k, v]) => `<div class="row"><span>${k}</span><b>${money(v)}</b></div>`).join('') || '<p class="mut" style="margin-top:8px">Aún no hay ventas hoy.</p>'}</div>
  <div class="card"><b>Más vendidos</b>${top.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${v}</b></div>`).join('') || '<p class="mut" style="margin-top:8px">Sin datos.</p>'}</div></div>
  <p class="mut" style="margin-top:12px">Este sistema no emite boletas ni facturas; solo controla pedidos, cuentas y ventas internas.</p>`;
}
function cartaHTML() {
  const l = L();
  return `<h2>Carta y mesas</h2><div class="cols"><div class="card"><b>Platos</b>
    ${buscaHTML('q-carta', 'Buscar plato o producto de la carta…')}${filtra(l.menu, 'q-carta').map(i =>`<div class="row ${i.on ? '' : 'off'}"><div>${esc(i.n)}<div class="mut">${esc(i.c)} · ${money(i.p)} · se prepara en ${i.e === 'cafeteria' ? 'cafetería' : 'cocina'}${i.cb ? ' · código ' + esc(i.cb) : ''}</div></div>
      <div style="display:flex;gap:6px"><button class="btn-line" data-act="est" data-id="${i.id}">${i.e === 'cafeteria' ? '☕ Cafetería' : 'Cocina'}</button><button class="btn-line" data-act="opcedit" data-id="${i.id}" title="Opciones rápidas para la comanda">Opciones${i.o ? ' ✓' : ''}</button><button class="btn-line" data-act="toggle" data-id="${i.id}">${i.on ? 'Disponible' : 'Agotado'}</button><button class="btn-bad" data-act="del" data-id="${i.id}">Quitar</button></div></div>`).join('') || '<p class="mut">Sin platos.</p>'}</div>
  <div><div class="card" style="display:grid;gap:8px"><b>Agregar plato</b><p class="mut" style="margin:0">Aquí solo se agregan productos para la venta. Lo que compras para producirlos (mermeladas, tarros de duraznos, cremas…) va en la pestaña Inventario de producción.</p>
    <input id="an" placeholder="Nombre"><input id="ac" placeholder="Categoría (Café, Platos…)" list="cl"><datalist id="cl">${[...new Set(l.menu.map(i => i.c))].map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <input id="ap" type="number" inputmode="numeric" placeholder="Precio">
    <input id="acb" autocomplete="off" placeholder="Código de barras (opcional, escanéalo aquí)">
    <input id="ast" type="number" inputmode="numeric" min="0" placeholder="Stock inicial (opcional)">
    <label class="mut">Se prepara en<select id="ae"><option value="cocina">Cocina (platos, sándwiches, fríos, pasteles)</option><option value="cafeteria">Cafetería (cafés y bebidas calientes)</option></select></label>
    <button class="btn" data-act="add">Agregar</button></div>
  <div class="card" style="margin-top:12px"><b>Garzones</b>${l.garzones.map(g => `<div class="row ${g.on ? '' : 'off'}"><span>${esc(g.n)}</span><div style="display:flex;gap:6px"><button class="btn-line" data-act="gtoggle" data-id="${g.id}">${g.on ? 'Activo' : 'Inactivo'}</button><button class="btn-bad" data-act="gdel" data-id="${g.id}">Quitar</button></div></div>`).join('') || '<p class="mut" style="margin:8px 0">Aún no hay garzones.</p>'}
    <div style="display:flex;gap:8px;margin-top:8px"><input id="gn" placeholder="Nombre del garzón"><button class="btn" data-act="gadd">Agregar</button></div></div>
  <div class="card" style="margin-top:12px"><b>Cocineras</b>
    <p class="mut" style="margin:4px 0 6px">${l.adminPin ? 'Cada cocinera entra con su PIN en el dispositivo de la cocina. Ese dispositivo se queda en Cocina y suena con cada comanda nueva. Si no hay cocineras, entra el botón "Cocina" sin PIN.' : 'Primero crea el PIN de la administradora (más abajo): las cocineras entran con su PIN cuando el local tiene accesos por usuario.'}</p>
    ${(l.cocineras || []).map(c => `<div class="row ${c.on ? '' : 'off'}"><div>${esc(c.n)}<div class="mut">${c.pin ? 'con PIN' : 'sin PIN'}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${l.adminPin ? `<input id="cp-${c.id}" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" style="width:90px"><button class="btn-line" data-act="setcpin" data-id="${c.id}">Guardar PIN</button>` : ''}<button class="btn-line" data-act="ctoggle" data-id="${c.id}">${c.on ? 'Activa' : 'Inactiva'}</button><button class="btn-bad" data-act="cdel" data-id="${c.id}">Quitar</button></div></div>`).join('') || '<p class="mut" style="margin:6px 0">Aún no hay cocineras.</p>'}
    <div style="display:flex;gap:8px;margin-top:8px"><input id="cn" placeholder="Nombre de la cocinera"><button class="btn" data-act="cadd">Agregar</button></div></div>
  <div class="card" style="margin-top:12px;display:grid;gap:8px"><b>Pedido por QR</b>
    <p class="mut">${l.qr ? 'Activado: el cliente escanea el QR de su mesa, elige y el pedido llega solo a cocina (y a cafetería), con aviso sonoro. Sin cuenta ni descarga.' : 'Apagado. Al activarlo, cada mesa tendrá un QR para que el cliente pida desde su celular.'}</p>
    <button class="${l.qr ? 'btn-bad' : 'btn-ok'}" data-act="qrtoggle">${l.qr ? 'Desactivar pedido por QR' : 'Activar pedido por QR'}</button>
    <button class="btn-line" data-act="qrimprimir">Imprimir QR de las mesas</button></div>
  <div class="card" style="margin-top:12px;display:grid;gap:8px"><b>Cantidad de mesas</b>
    <label class="mut">Mesas del primer piso<input id="nm" type="number" min="1" max="60" value="${l.mesas}"></label>
    <label class="mut">Mesas del segundo piso (0 si no tiene)<input id="nm2" type="number" min="0" max="30" value="${l.mesas2}"></label>
    <button class="btn-line" data-act="mesas">Guardar</button></div>
  <div class="card" style="margin-top:12px;display:grid;gap:8px"><b>Propina sugerida</b>
    <p class="mut">Porcentaje que se sugiere al cobrar cada cuenta. Quitarla o cambiarla en una cuenta necesita tu autorización (o tu PIN en el equipo del garzón).</p>
    <label class="mut">Porcentaje (%)<input id="ppct" type="number" min="0" max="30" value="${pctProp()}"></label>
    <button class="btn-line" data-act="setppct">Guardar</button></div>
  <div class="card" style="margin-top:12px;display:grid;gap:8px"><b>PIN de acceso</b>
    <p class="mut">${l.adminPin ? 'Activado: cada persona entra con su PIN. Los garzones solo ven Mesas y cobros; las ventas son solo para la administradora.' : 'Aún sin PIN: todos ven todo. Crea el PIN de la administradora para activar los accesos por usuario.'}</p>
    <label class="mut">${l.adminPin ? 'Cambiar PIN de la administradora' : 'PIN de la administradora (4 a 8 números)'}<input id="apin" type="password" inputmode="numeric" autocomplete="off" placeholder="••••"></label>
    <button class="btn" data-act="setadminpin">Guardar PIN de administradora</button>
    ${l.adminPin ? `<p class="mut">Los PIN de los garzones se crean en la pestaña Garzones.</p>
    <button class="btn-bad" data-act="quitarpin">Desactivar accesos por usuario</button>` : ''}</div></div></div>`;
}
function adminShell() {
  return `<header><div><b>Admin Protech</b><small>Protech Resto</small></div><nav></nav>
    <button class="btn-line" style="padding:6px 12px" data-act="logout">Salir</button></header><main>${adminHTML()}</main>`;
}
function adminLocalesHTML() {
  const v = S.av, f = S.af;
  const lista = v.locales.map(l => `<div class="card" style="margin-bottom:12px"><div class="row" style="padding-top:0"><div><b>${esc(l.nombre)}</b><div class="mut">${l.mesas} mesas</div></div></div>
    ${l.usuarios.map(u => `<div class="row"><div>${esc(u.email)} <span class="pill">${u.confirmado ? 'Activo' : 'Invitación pendiente'}</span></div>
      <div style="display:flex;gap:6px">${u.confirmado ? '' : `<button class="btn-line" data-act="a_reenviar" data-email="${esc(u.email)}">Reenviar</button>`}<button class="btn-line" style="color:var(--bad)" data-act="a_quitar" data-email="${esc(u.email)}" data-lid="${l.id}" data-ln="${esc(l.nombre)}">Quitar</button></div></div>`).join('') || '<p class="mut">Sin usuarios.</p>'}
    <div style="display:flex;gap:8px;margin-top:10px"><input id="ae-${l.id}" type="email" placeholder="Agregar otro correo a este local"><button class="btn" style="white-space:nowrap" data-act="a_add" data-lid="${l.id}">Invitar</button></div></div>`).join('');
  return `<h2>Admin Protech · Locales y usuarios</h2>
    ${v.msg ? `<div class="card" style="margin-bottom:12px;color:var(--ok)">${esc(v.msg)}</div>` : ''}
    ${v.err ? `<div class="card" style="margin-bottom:12px;color:var(--bad)">${esc(v.err)}</div>` : ''}
    <div class="card" style="display:grid;gap:8px;margin-bottom:16px"><b>Nuevo local</b>
      <input id="a-nombre" placeholder="Nombre del local (ej. Café Central)" value="${esc(f.nombre)}">
      <input id="a-mesas" type="number" min="1" max="60" placeholder="Cantidad de mesas" value="${esc(f.mesas)}">
      <input id="a-email" type="email" placeholder="Correo del dueño (recibirá la invitación)" value="${esc(f.email)}">
      <button class="btn" data-act="a_crear" ${S.busy ? 'disabled' : ''}>Crear local e invitar por correo</button>
      <div class="hint">El dueño recibe un correo desde Protech con un enlace para crear su clave. Si el correo ya tiene cuenta (por ejemplo del POS), solo se asigna al local.</div></div>
    ${v.cargado ? lista || '<p class="mut">Aún no hay locales.</p>' : '<p class="mut">Cargando locales…</p>'}`;
}
function render() {
  const app = $('#app');
  const ae = document.activeElement, aid = ae && ae.id, ss = ae && ae.selectionStart;
  try { renderInner(app); actualizaVuelto(); } finally {
    if (aid) { const el = document.getElementById(aid); if (el && el !== document.activeElement) { el.focus(); try { el.setSelectionRange(ss, ss); } catch (x) {} } }
    /* en PC, en la venta mostrador el cursor vuelve solo al campo del lector */
    else if ((S.mos && S.view === 'mesas') && matchMedia('(pointer:fine)').matches) { const sc = document.getElementById('scan-mos'); if (sc) sc.focus(); }
    else if ((S.mesa && !S.mos && S.view === 'mesas' && !S.cerrando && !S.parcial) && matchMedia('(pointer:fine)').matches) { const bs = document.getElementById('bus-mos'); if (bs) bs.focus(); }
    try { if (typeof chatSync === 'function') chatSync(); } catch (x) { console.error(x); }
  }
}
function renderInner(app) {
  if (S.setpass || !S.user) { app.innerHTML = loginHTML(); return; }
  if (!D) { app.innerHTML = S.admin ? adminShell() : loginHTML(); return; }
  restaurarRol();
  if (rolesOn() && !S.rol) { app.innerHTML = quienHTML(); return; }
  if (!S.admin || S.view !== 'admin') { if (!misTabs().includes(S.view)) S.view = misTabs()[0]; }
  const v = { mesas: mesasHTML, cocina: cocinaHTML, cafe: cafeHTML, resv: resvHTML, turno: turnoHTML, inv: invHTML, prod: insumosHTML, abast: abastHTML, resumen: resumenHTML, caja: cajaHTML, garz: garzHTML, coms: comsHTML, carta: cartaHTML, bit: bitHTML, admin: adminHTML }[S.view];
  app.innerHTML = shell(v());
}

/* ---------- QR de las mesas: una hoja imprimible, un QR por mesa ---------- */
function imprimirQR() {
  const l = L(), base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'pedir.html?l=' + encodeURIComponent(l.id) + '&m=';
  const mesas = []; for (let n = 1; n <= l.mesas; n++) mesas.push(n); for (let k = 1; k <= (l.mesas2 || 0); k++) mesas.push(100 + k);
  const svg = m => { const q = qrcode(0, 'M'); q.addData(base + m); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); };
  const w = window.open('', '_blank'); if (!w) { alert('Permite las ventanas emergentes para imprimir los QR.'); return; }
  w.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>QR de mesas · ' + esc(l.name) + '</title><style>' +
    'body{font-family:system-ui,sans-serif;margin:0;padding:12px}h1{font-size:1rem;margin:0 0 10px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}' +
    '.t{border:2px solid #0f172a;border-radius:14px;padding:14px;text-align:center;break-inside:avoid}.t svg{width:100%;max-width:220px;height:auto}' +
    '.t b{display:block;font-size:1.5rem;margin-top:6px}.t span{display:block;font-size:.95rem;color:#475569;margin-top:2px}' +
    '@media print{h1{display:none}body{padding:0}}</style></head><body><h1>Imprime esta hoja (Ctrl+P) y recorta un QR por mesa.</h1><div class="g">' +
    mesas.map(m => '<div class="t">' + svg(m) + '<b>' + esc(nm(m)) + '</b><span>Escanea y pide desde tu mesa</span><span>' + esc(l.name) + '</span></div>').join('') + '</div></body></html>');
  w.document.close();
}

/* ---------- Acciones ---------- */
document.addEventListener('input', e => {
  if (e.target.dataset && 'keep' in e.target.dataset) S.f[e.target.id] = e.target.value;
  if (e.target.id === 'bus-mos' || BUSQ.includes(e.target.id)) render();
  /* si el lector no manda Enter al final, el código se toma solo cuando termina de llegar */
  if (e.target.id === 'scan-mos') { clearTimeout(scanT); const el = e.target; scanT = setTimeout(() => { const v = el.value; if (S.mos && el.isConnected && v.trim().length >= 6) { el.value = ''; escanMostrador(v); } }, 250); }
  if (e.target.id === 'nota') S.note = e.target.value;
  if (/^(dn[acd]-\d+|ctarj|ctrans)$/.test(e.target.id)) dnActualiza();
  if (e.target.id === 'pefec') {
    S.pe = e.target.value;
    const t = $('#totpagar');
    if (t) { const b = +t.dataset.base, tot = calcPago(b).total; t.textContent = money(tot); const v = $('#vuelto'); if (v) { v.dataset.total = tot; actualizaVuelto(); } const j = document.querySelector('[data-act="rec"]'); if (j) j.dataset.v = tot; }
  }
  if (e.target.id === 'recib') { S.rc = e.target.value; actualizaVuelto(); }
  if (e.target.id === 'ptarj') {
    S.pt = e.target.value;
    /* actualiza el total en pantalla sin redibujar (así no se pierde el cursor al escribir) */
    const t = $('#totpagar');
    if (t) { const b = +t.dataset.base; t.textContent = money(calcPago(b).total); }
  }
  if (e.target.id === 'a-nombre') S.af.nombre = e.target.value;
  if (e.target.id === 'a-mesas') S.af.mesas = e.target.value;
  if (e.target.id === 'a-email') S.af.email = e.target.value;
});
document.addEventListener('change', e => {
  if (e.target.dataset && 'keep' in e.target.dataset) S.f[e.target.id] = e.target.value;
  if (e.target.id === 'metodo') { S.metodo = e.target.value; render(); }
  if (e.target.id === 'pedonde') { S.peDonde = e.target.value; render(); }
  if (e.target.id === 'garz') { S.garzon = e.target.value; render(); }
  if (e.target.id === 'cmg') render();
  if (e.target.id === 'g-tipo' || e.target.id === 'c-tipo' || e.target.id === 'c-pago' || e.target.id === 'bit-t' || e.target.id === 'd-tipo' || e.target.id === 'c-corte') render();
  if (e.target.dataset && e.target.dataset.act === 'propina') {
    /* quitar o dejar la propina ya no necesita autorización: la decide el garzón */
    S.propina = e.target.checked;
    render();
  }
  if (e.target.id === 'proppct') {
    const v = +e.target.value;
    S.propPct = v === pctProp() ? null : v;
    render();
  }
});
/* Código de barras: el lector USB escribe el código y pulsa Enter, igual que un teclado */
/* compara códigos sin espacios, guiones, mayúsculas ni ceros a la izquierda (EAN-13 y UPC-A del mismo producto) */
const cbN = t => String(t ?? '').replace(/[\s\-]/g, '').toLowerCase().replace(/^0+/, '');
const buscaCb = cb => { const n = cbN(cb); return n ? L().menu.find(x => x.cb && cbN(x.cb) === n) : null; };
let scanT = null;
function escanMostrador(raw) {
  const cb = (raw || '').trim(); if (!cb) return;
  delete S.f['scan-mos'];
  const it = buscaCb(cb);
  if (!it) toast('Código no registrado: ' + cb, 'tk-c');
  else if (!it.on) toast(it.n + ' está agotado en la carta', 'tk-c');
  else if (it.s != null && (S.cart[it.id] || 0) >= it.s) toast('Sin stock suficiente de ' + it.n, 'tk-c');
  else { S.cart[it.id] = (S.cart[it.id] || 0) + 1; toast('+1 ' + it.n + ' · ' + money(it.p), 'tk-l'); }
  render();
}
async function escanInventario(raw) {
  const cb = (raw || '').trim(); if (!cb || S.busy) return;
  const it = buscaCb(cb);
  if (!it) { S.nuevo = { cb }; render(); return; }
  const q = Math.max(1, Math.round(+S.f['scan-q'] || 1));
  S.busy = true;
  try {
    const r = it.s == null ? await sb.from('resto_menu').update({ stock: q }).eq('id', it.id) : await sb.rpc('resto_stock_mover', { p_menu: it.id, p_delta: q, p_motivo: 'entrada', p_por: S.quien || '', p_log: true });
    if (!fallo(r)) { if (it.s == null) await sb.from('resto_stock_mov').insert({ local_id: D.id, menu_id: it.id, delta: q, motivo: 'entrada', por: S.quien || '' }); await cargar(); const n = L().menu.find(x => x.id === it.id); toast('+' + q + ' ' + it.n + ' · stock ' + (n && n.s != null ? n.s : q), 'tk-l'); }
  } catch (x) { console.error(x); }
  S.busy = false; render();
}
document.addEventListener('keydown', e => {
  /* en venta mostrador, si el cursor no está en un campo, lo que escribe el lector va al campo de escaneo */
  if ((S.mos && S.view === 'mesas') && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName || '')) { const sc = document.getElementById('scan-mos'); if (sc) sc.focus(); }
  else if ((S.mesa && !S.mos && S.view === 'mesas' && !S.cerrando && !S.parcial) && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName || '')) { const bs = document.getElementById('bus-mos'); if (bs) bs.focus(); }
  if (e.key !== 'Enter') return;
  const id = e.target.id || '';
  if (id === 'lpass' || id === 'lmail') document.querySelector('[data-act=login]').click();
  else if (id === 'qpin') { e.preventDefault(); const b = document.querySelector('[data-act=qok]'); if (b) b.click(); }
  else if (id === 'scan-mos') { e.preventDefault(); clearTimeout(scanT); const v = e.target.value; e.target.value = ''; escanMostrador(v); }
  else if (id === 'scan-inv') { e.preventDefault(); const v = e.target.value; e.target.value = ''; escanInventario(v); }
  else if (id === 'bus-mos') { e.preventDefault(); const r = busMos(); if (r.length) { addMos(r[0].id); render(); } }
  else if (id.startsWith('bq-')) { e.preventDefault(); S.f[id] = e.target.value; addMos(id.slice(3)); render(); }
  else if (id.startsWith('pr-')) { e.preventDefault(); S.f[id] = e.target.value; const b = document.querySelector('[data-act=pr_set][data-id="' + id.slice(3) + '"]'); if (b) b.click(); }
  else if (id.startsWith('cb-')) { e.preventDefault(); S.f[id] = e.target.value; const b = document.querySelector('[data-act=cb_set][data-id="' + id.slice(3) + '"]'); if (b) b.click(); }
  else if (id === 'acb') e.preventDefault();
});
/* ---------- Sin conexión: cola de envío ----------
   Tomar un pedido, marcarlo entregado y cobrar una mesa siguen funcionando sin internet: se guardan en este equipo,
   se ven en pantalla y se envían solos al volver la conexión. Cada fila lleva su propio id, así un reintento nunca duplica. */
const esRed = r => !!(r && r.error && (/fetch|network|load failed|timeout|conexi|offline/i.test(r.error.message || '') || (typeof navigator !== 'undefined' && navigator.onLine === false)));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
let OUT = [], outBusy = false, OUTLID = null;
const outKey = () => 'resto_out_' + (D ? D.id : '');
function outLoad() { if (!D || OUTLID === D.id) return; OUTLID = D.id; try { OUT = JSON.parse(localStorage.getItem(outKey()) || '[]'); } catch (e) { OUT = []; } }
function outSave() { try { localStorage.setItem(outKey(), JSON.stringify(OUT)); } catch (e) {} outBar(); }
function outBar() {
  let el = document.getElementById('offbar');
  if (!el) { el = document.createElement('div'); el.id = 'offbar'; el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:60;padding:8px 14px;font-weight:700;text-align:center;color:#fff;font-size:.95rem'; document.body.appendChild(el); }
  const off = navigator.onLine === false || S.sinRed;
  if (!OUT.length && !off) { el.style.display = 'none'; return; }
  el.style.display = 'block'; el.style.background = off ? '#b45309' : '#1c1917';
  el.textContent = off ? '📶 Sin conexión' + (OUT.length ? ' · ' + OUT.length + ' operación(es) guardada(s), se enviarán solas' : ' · puedes seguir tomando pedidos y cobrando mesas') : '⏳ Enviando ' + OUT.length + ' operación(es) pendiente(s)…';
}
function comandaOpt(f) { return { id: f.id, mesa: f.mesa, items: f.items, est: (f.items && f.items[0] && f.items[0].e === 'cafeteria') ? 'cafeteria' : 'cocina', note: f.nota || '', estado: f.estado, garzon: f.garzon || '', t: f.t || Date.now(), cerrada: false }; }
/* vuelve a poner en pantalla lo que aún no llegó al servidor (para que una recarga no lo haga desaparecer) */
function outAplicar() {
  if (!D || !OUT.length) return;
  OUT.forEach(o => {
    if (o.k === 'enviar') {
      o.filas.forEach(f => { if (!D.comandas.some(c => c.id === f.id)) D.comandas.push(comandaOpt(f)); });
      if (!o.insOk) (o.stock || []).forEach(([mid, q]) => { const m = D.menu.find(x => x.id === mid); if (m && m.s != null) m.s -= q; });
    } else if (o.k === 'pagar') {
      D.comandas = D.comandas.filter(c => !o.cids.includes(c.id));
      if (!D.cuentas.some(c => c.id === o.cuenta.id)) D.cuentas.push({ id: o.cuenta.id, mesa: o.cuenta.mesa, total: o.cuenta.total, propina: o.cuenta.propina || 0, pe: o.cuenta.propina_efec || 0, pq: !!o.cuenta.propina_efec_caja, pt: o.cuenta.propina_tarj || 0, metodo: o.cuenta.metodo, garzon: o.cuenta.garzon || '', items: o.cuenta.items, turno_id: o.cuenta.turno_id || null, cobrado_por: o.cuenta.cobrado_por || '', t: o.t });
    } else if (o.k === 'avanzar') {
      const c = D.comandas.find(x => x.id === o.id); if (c) { c.estado = o.to; if (o.cierra) D.comandas = D.comandas.filter(x => x.id !== o.id); }
    }
  });
}
async function outVaciar() {
  if (outBusy || !D || !OUT.length || navigator.onLine === false) return;
  outBusy = true; outBar();
  try {
    while (OUT.length) {
      const o = OUT[0]; let r;
      if (o.k === 'enviar') {
        if (!o.insOk) { r = await sb.from('resto_comandas').upsert(o.filas.map(f => ({ id: f.id, local_id: f.local_id, mesa: f.mesa, items: f.items, nota: f.nota, garzon: f.garzon, estado: f.estado })), { onConflict: 'id', ignoreDuplicates: true }); if (r && r.error) { if (esRed(r)) { S.sinRed = true; break; } OUT.shift(); outSave(); alert('No se pudo enviar un pedido guardado (mesa ' + o.filas[0].mesa + '): ' + r.error.message); continue; } o.insOk = true; outSave(); }
        let cortado = false;
        while ((o.stockHecho || 0) < (o.stock || []).length) { const [mid, q] = o.stock[o.stockHecho || 0]; const rr = await sb.rpc('resto_stock_mover', { p_menu: mid, p_delta: -q, p_motivo: 'venta', p_por: o.por || '', p_log: false }); if (rr && rr.error && esRed(rr)) { cortado = true; break; } o.stockHecho = (o.stockHecho || 0) + 1; outSave(); }
        if (cortado) { S.sinRed = true; break; }
      } else if (o.k === 'pagar') {
        if (!o.cuentaOk && o.cuenta.total > 0) { r = await sb.from('resto_cuentas').upsert(o.cuenta, { onConflict: 'id', ignoreDuplicates: true }); if (errPq(r)) r = await sb.from('resto_cuentas').upsert(sinColPq(o.cuenta), { onConflict: 'id', ignoreDuplicates: true }); if (r && r.error) { if (esRed(r)) { S.sinRed = true; break; } OUT.shift(); outSave(); alert('No se pudo enviar un cobro guardado (mesa ' + o.cuenta.mesa + '): ' + r.error.message); continue; } }
        o.cuentaOk = true; outSave();
        r = await sb.from('resto_comandas').update({ cerrada: true }).in('id', o.cids); if (r && r.error && esRed(r)) { S.sinRed = true; break; }
        if (o.pedido) await sb.from('resto_pedidos').update({ cerrado: true }).eq('local_id', D.id).eq('num', o.pedido);
      } else if (o.k === 'avanzar') {
        r = await sb.from('resto_comandas').update({ estado: o.to, ...(o.cierra ? { cerrada: true } : {}) }).eq('id', o.id); if (r && r.error && esRed(r)) { S.sinRed = true; break; }
      }
      OUT.shift(); S.sinRed = false; outSave();
    }
  } catch (e) { S.sinRed = true; }
  outBusy = false; outBar();
  if (!OUT.length && D) { try { await cargar(); render(); } catch (e) {} }
}
window.addEventListener('online', () => { S.sinRed = false; outBar(); outVaciar(); });
window.addEventListener('offline', () => { S.sinRed = true; outBar(); });
setInterval(() => { if (OUT.length) outVaciar(); outBar(); }, 12000);
const fallo = r => { if (r && r.error) { if (esRed(r)) { S.sinRed = true; outBar(); alert('Sin conexión: esto no se pudo guardar. Reintenta cuando vuelva internet.'); return true; } if (/row-level security|permission denied|violates row-level/i.test(r.error.message || '')) { S.aut = null; S.desc = null; S.propina = true; S.propPct = null; alert('No tienes permiso para hacer esto, o la autorización venció. Si debería poder, vuelve a entrar con tu PIN o pide de nuevo la autorización de la administradora.'); sb.rpc('resto_sesion_estado').then(x => { if (!x.error && !x.data && rolesOn() && S.rol && S.rol !== 'cocina') { S.rol = null; S.quien = ''; olvidarRol(); render(); } }); return true; }
    S.lastErr = true; S.err = 'Error: ' + r.error.message; alert('No se pudo guardar: ' + r.error.message); return true; } return false; };

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
  if (S.busy) return;
  const a = b.dataset.act, d = b.dataset;
  if (['mostrador', 'mospagar'].includes(a) && !puedeCobrar()) { alert('La venta por mostrador la cobra la administradora o un garzón autorizado con PIN.'); return; }
  if (a.startsWith('ins') && ['insadd', 'inscompra', 'insuso', 'insmerma', 'inscont', 'insmin', 'insoff'].includes(a) && !esAdm()) { alert('El inventario de producción lo maneja la administradora.'); return; }
  if (['tabrir', 'tcerrar', 'gasto', 'retiro'].includes(a) && !puedeCobrar()) { alert('Solo la administradora o un garzón autorizado con PIN puede abrir y cerrar la caja.'); return; }
  if (['cobrarmesa', 'cerrar', 'parcial', 'pagar', 'pagarparte'].includes(a) && !puedeCobrarMesa()) { alert('Solo la administradora o los garzones pueden cobrar mesas.'); return; }
  if (a === 'mesa' && !puedeVerMesa(+d.n)) { alert('Esta mesa la atiende ' + (duenoMesa(+d.n) || 'otro garzón') + '. Solo ella o él puede tomar pedidos en esta mesa.'); return; }
  if (a === 'cobrarmesa' && !puedeCobrarEsta(+d.n)) { alert('Esta mesa la atiende ' + (duenoMesa(+d.n) || 'otro garzón') + '. Solo ella o él puede cobrarla.'); return; }
  if (['enviar', 'cerrar', 'parcial', 'pagar', 'pagarparte'].includes(a) && S.mesa !== null && !S.mos) {
    if (a === 'enviar' ? !mesaPropia(S.mesa) : !puedeCobrarEsta(S.mesa)) { alert('Esta mesa la atiende ' + (duenoMesa(S.mesa) || 'otro garzón') + '. Tú no puedes ' + (a === 'enviar' ? 'tomar pedidos' : 'cobrar') + ' en ella.'); return; }
  }
  let pagoInfo = null;
  if (['pagar', 'pagarparte', 'mospagar'].includes(a)) {
    const b = baseCobro(a);
    if (b > 0 && recibidoMal(b)) { alert('El efectivo recibido es menor al total a pagar. Revisa el monto.'); return; }
    const tp = totalPago(b), rc = S.rc !== '' && S.rc !== undefined ? Math.round(+S.rc) : null;
    pagoInfo = a === 'mospagar' && !cajaAbierta() ? null : { m: S.metodo, tp, rc }; S.lastErr = false;
  }
  try {
    if (a === 'login') {
      const email = $('#lmail').value.trim(), password = $('#lpass').value;
      if (!email || !password) { S.err = 'Escribe tu correo y clave'; render(); return; }
      S.busy = true; S.err = ''; render();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { S.busy = false; S.err = 'Correo o clave incorrectos'; render(); return; }
      S.user = data.user; await cargar(); suscribir(); S.view = 'mesas'; S.busy = false; render(); return;
    }
    if (a === 'sonido') {
      const o = ['ambos', 'cocina', 'salon', 'off']; SND = o[(o.indexOf(SND) + 1) % o.length];
      try { localStorage.setItem('pr-snd', SND); } catch (x) {}
      if (SND === 'cocina' || SND === 'ambos') sonarCocina(); else if (SND === 'salon') sonarListo();
      pantalla(); render(); return;
    }
    if (a === 'olvide') { S.olvide = true; S.err = ''; S.ok = ''; render(); return; }
    if (a === 'volverlogin') { S.olvide = false; S.err = ''; S.ok = ''; render(); return; }
    if (a === 'enviarlink') {
      const email = $('#rmail').value.trim(); if (!email) { S.err = 'Escribe tu correo'; render(); return; }
      S.busy = true; S.err = ''; render();
      await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      S.busy = false; S.ok = 'Si el correo está registrado, te enviamos un enlace. Revisa tu bandeja (y spam).'; render(); return;
    }
    if (a === 'guardarclave') {
      const p1 = $('#np1').value, p2 = $('#np2').value;
      if (p1.length < 8) { S.err = 'La clave debe tener al menos 8 caracteres'; render(); return; }
      if (p1 !== p2) { S.err = 'Las claves no coinciden'; render(); return; }
      S.busy = true; S.err = ''; render();
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) { S.busy = false; S.err = 'No se pudo guardar: ' + error.message; render(); return; }
      history.replaceState(null, '', location.pathname); S.setpass = false;
      const { data } = await sb.auth.getSession(); S.user = data.session ? data.session.user : null;
      if (S.user) { await cargar(); suscribir(); }
      S.busy = false; render(); return;
    }
    if (a === 'a_quitar') {
      if (!confirm('¿Quitar a ' + d.email + ' del local "' + d.ln + '"?\n\nPierde el acceso a este local. Su cuenta no se elimina.')) return;
      S.busy = true; S.av.msg = ''; S.av.err = ''; render();
      try {
        const { data: n, error } = await sb.rpc('resto_quitar_usuario', { p_email: d.email, p_local: d.lid });
        if (error) throw new Error(error.message);
        S.av.msg = n ? d.email + ' fue quitado del local ' + d.ln : 'No se encontró a ' + d.email + ' en ese local';
        const l = await llamarAdmin({ action: 'list' }); S.av.locales = l.locales;
      } catch (x) { S.av.err = x.message; }
      S.busy = false; render(); return;
    }
    if (a === 'a_crear' || a === 'a_add' || a === 'a_reenviar') {
      const emIn = a === 'a_add' ? (($('#ae-' + d.lid) || {}).value || '') : '';
      S.busy = true; S.av.msg = ''; S.av.err = ''; render();
      try {
        if (a === 'a_crear') {
          const j = await llamarAdmin({ action: 'create_local', nombre: S.af.nombre, mesas: S.af.mesas, email: S.af.email });
          S.av.msg = 'Local creado. ' + (j.persona.estado === 'invitado' ? 'Invitación enviada a ' : 'Asignado a ') + j.persona.email;
          S.af = { nombre: '', mesas: '6', email: '' };
        } else if (a === 'a_add') {
          const em = emIn;
          const j = await llamarAdmin({ action: 'add_user', local_id: d.lid, email: em });
          S.av.msg = (j.persona.estado === 'invitado' ? 'Invitación enviada a ' : 'Asignado: ') + j.persona.email;
        } else {
          await llamarAdmin({ action: 'resend_invite', email: d.email }); S.av.msg = 'Invitación reenviada a ' + d.email;
        }
        const l = await llamarAdmin({ action: 'list' }); S.av.locales = l.locales;
      } catch (x) { S.av.err = x.message; }
      S.busy = false; render(); return;
    }
    if (a === 'qsel') {
      S.pinErr = '';
      if (d.k === 'cocina') { entrar('cocina', 'Cocina'); render(); return; }
      if (d.k.startsWith('c:')) { const c = D.cocineras.find(x => x.n === d.k.slice(2) && x.on); if (c && !c.pin) { entrar('cocina', c.n); render(); return; } }
      if (d.k.startsWith('g:')) { const g = D.garzones.find(x => x.n === d.k.slice(2)); if (g && !g.pin) { const r = await loginRol('garzon', g.id, ''); if (r.legacy) SIN_PASES = true; entrar('garzon', g.n, r.ok ? r.token : ''); render(); return; } }
      S.qk = d.k; render(); return;
    }
    if (a === 'qback') { S.qk = null; S.pinErr = ''; render(); return; }
    if (a === 'qok') {
      const pin = ($('#qpin') || {}).value || '', k = S.qk; if (!k) return;
      if (k === 'ing') {
        const r = await sb.rpc('resto_login_ing', { p_clave: pin });
        if (r.error && sinFuncion(r.error)) {
          const v = await sb.rpc('resto_verificar_ingeniero', { p_clave: pin });
          if (v.error) { S.pinErr = 'No se pudo verificar la clave. Intenta de nuevo.'; render(); return; }
          if (v.data !== true) { S.pinErr = 'Clave incorrecta'; render(); return; }
          SIN_PASES = true; entrar('ingeniero', 'Carlos Oporto'); render(); return;
        }
        if (r.error) { S.pinErr = 'No se pudo verificar la clave. Intenta de nuevo.'; render(); return; }
        if (!(r.data && r.data.ok)) { S.pinErr = 'Clave incorrecta'; render(); return; }
        entrar('ingeniero', 'Carlos Oporto', r.data.token); render(); return;
      }
      if (k.startsWith('c:')) {
        const c = D.cocineras.find(x => x.n === k.slice(2) && x.on);
        if (!c) { S.pinErr = 'PIN incorrecto'; render(); return; }
        const r = await loginRol('cocina', c.id, pin);
        if (r.legacy) { SIN_PASES = true; if (!(c.pin && (await hpin('c:' + c.id, pin)) === c.pin)) { S.pinErr = 'PIN incorrecto'; render(); return; } entrar('cocina', c.n); render(); return; }
        if (!r.ok) { S.pinErr = msgLogin(r); render(); return; }
        entrar('cocina', c.n, r.token); render(); return;
      }
      const adm = k === 'admin', g = adm ? null : D.garzones.find(x => x.n === k.slice(2));
      if (!adm && !g) { S.pinErr = 'PIN incorrecto'; render(); return; }
      const r = await loginRol(adm ? 'admin' : 'garzon', adm ? 'admin' : g.id, pin);
      if (r.legacy) {
        SIN_PASES = true;
        const ok = adm ? (await hpin('admin', pin)) === D.adminPin : (await hpin('g:' + g.id, pin)) === g.pin;
        if (!ok) { S.pinErr = 'PIN incorrecto'; render(); return; }
        entrar(adm ? 'admin' : 'garzon', adm ? 'Administradora' : g.n); render(); return;
      }
      if (!r.ok) { S.pinErr = msgLogin(r); render(); return; }
      entrar(adm ? 'admin' : 'garzon', adm ? 'Administradora' : g.n, r.token); render(); return;
    }
    if (a === 'descabrir') { S.autForm = 'desc'; S.autErr = ''; render(); return; }
    if (a === 'descquitar') { S.desc = null; render(); return; }
    if (a === 'autno') { S.autForm = null; S.autPend = null; S.autErr = ''; render(); return; }
    if (a === 'autok') {
      const f = S.autForm; if (!f) return;
      let dsc = null;
      if (f === 'desc') {
        const t = S.f['d-tipo'] === 'monto' ? 'monto' : S.f['d-tipo'] === 'cortesia' ? 'cortesia' : 'pct', v = Math.round(+S.f['d-val'] || 0);
        if (t !== 'cortesia' && !(v > 0)) { S.autErr = 'Ingresa el valor del descuento.'; render(); return; }
        if (t === 'pct' && v > 100) { S.autErr = 'El porcentaje no puede superar 100.'; render(); return; }
        dsc = { t, v, motivo: S.f['d-mot'] || DESC_MOTIVOS[0] };
      }
      let by = S.quien || 'Administradora', tok = null;
      if (!esAdm()) {
        const pin = (S.f['aut-pin'] || '').trim();
        if (!/^\d{4,8}$/.test(pin) || !D.adminPin) { S.autErr = 'PIN incorrecto'; render(); return; }
        const lr = await loginRol('admin', 'admin', pin, true);
        if (lr.legacy) { if ((await hpin('admin', pin)) !== D.adminPin) { S.autErr = 'PIN incorrecto'; render(); return; } }
        else if (!lr.ok) { S.autErr = lr.error === 'bloqueado' ? msgLogin(lr) : 'PIN incorrecto'; render(); return; }
        else tok = lr.token;
        by = 'Administradora (PIN en el equipo de ' + (S.quien || 'garzón') + ')';
      }
      S.aut = { by, tok };
      if (dsc) S.desc = { ...dsc, aut: by };
      if (S.autPend) { if ('propina' in S.autPend) S.propina = S.autPend.propina; if ('pct' in S.autPend) S.propPct = S.autPend.pct; }
      S.autForm = null; S.autPend = null; S.autErr = ''; delete S.f['aut-pin']; render(); return;
    }
    if (a === 'cambiar') { await endSes(); if (RTOK) { try { await sb.rpc('resto_logout'); } catch (e) {} } S.rol = null; S.quien = ''; S.qk = null; S.mesa = null; S.garzon = ''; olvidarRol(); render(); return; }
    if (a === 'logout') { S.saliendo = true; EX = null; EXA = null; await endSes(); if (RTOK) { try { await sb.rpc('resto_logout'); } catch (e) {} } S.rol = null; S.quien = ''; S.qk = null; olvidarRol(); if (rt) { sb.removeChannel(rt); rt = null; } await sb.auth.signOut(); S.user = null; D = null; S.mesa = null; S.admin = false; S.av = { locales: [], cargado: false, msg: '', err: '' }; S.saliendo = false; render(); return; }
    if (a === 'rec') { S.rc = d.v; render(); return; }
    if (a === 'activarsonido') { ctx(); sonarListo(); pantalla(); setTimeout(render, 400); return; }
    if (a === 'tab') { S.view = d.v; S.mesa = null; if (d.v === 'garz') S.rp = null; if (d.v === 'coms') S.cm = null; if (d.v === 'turno') S.th = null; if (d.v === 'resumen') { S.rs = null; setTimeout(rsCargar, 0); } if (d.v === 'bit') { S.bit = null; S.bitCarg = false; } S.mos = false; }
    else if (a === 'mesa') { S.an = null; S.anp = null; delete S.f['bus-mos']; S.mesa = +d.n; S.cart = {}; S.note = ''; S.cerrando = false; S.parcial = false; S.sel = {}; resetCobro(); }
    else if (a === 'volver') { S.an = null; S.anp = null; delete S.f['bus-mos']; if (S.back) { S.view = S.back; S.back = null; } S.mesa = null; S.cerrando = false; S.parcial = false; S.sel = {}; resetCobro(); }
    else if (a === 'inc') { const it = L().menu.find(x => x.id === d.id); if (!(it && it.s != null && (S.cart[d.id] || 0) >= it.s)) S.cart[d.id] = (S.cart[d.id] || 0) + 1; }
    else if (a === 'anuabrir') { const c = abiertas(S.mesa).find(x => x.id === d.c), it = c && c.items[+d.i]; if (c && it && puedeVerMesa(S.mesa)) { S.an = { c: c.id, n: it.n }; S.anp = null; ['anu-q', 'anu-m', 'anu-t'].forEach(k => delete S.f[k]); } }
    else if (a === 'anucancel') { S.an = null; S.anp = null; S.anpE = ''; delete S.f['anu-pin']; }
    else if (a === 'anupin') { S.anp = d.id; S.an = null; S.anpE = ''; delete S.f['anu-pin']; }
    else if (a === 'mosadd') addMos(d.id);
    else if (a === 'dec') { S.cart[d.id] = Math.max(0, (S.cart[d.id] || 0) - 1); if (!S.cart[d.id]) delete S.cart[d.id]; }
    else if (a === 'cobrarmesa') { S.back = S.mos ? 'mesas' : S.view; S.mos = false; S.view = 'mesas'; S.mesa = +d.n; S.cart = {}; S.note = ''; S.cerrando = true; S.parcial = false; S.sel = {}; resetCobro(); S.propina = true; S.metodo = 'Efectivo'; }
    else if (a === 'mostrador') { delete S.f['bus-mos']; S.back = S.view; S.view = 'mesas'; S.mos = true; S.cart = {}; S.note = ''; S.propina = false; S.metodo = 'Efectivo'; resetCobro(); }
    else if (a === 'mosvolver') { delete S.f['bus-mos']; Object.keys(S.f).forEach(k => { if (k.startsWith('bq-')) delete S.f[k]; }); if (S.back && S.back !== 'mesas') S.view = S.back; S.back = null; S.mos = false; S.cart = {}; S.propina = true; resetCobro(); }
    else if (a === 'nuevoped') { S.np = { tipo: d.t }; S.f = {}; }
    else if (a === 'cancelnp') { S.np = null; S.f = {}; }
    else if (a === 'rphoy') { S.rpd = S.rph = fechaIso(new Date()); S.rp = null; }
    else if (a === 'rpsem') { const d = new Date(); S.rph = fechaIso(d); d.setDate(d.getDate() - 6); S.rpd = fechaIso(d); S.rp = null; }
    else if (a === 'rpmes') { const d = new Date(); S.rph = fechaIso(d); d.setDate(1); S.rpd = fechaIso(d); S.rp = null; }
    else if (a === 'rpver') { const x = $('#rpd').value, y = $('#rph').value; if (x && y) { S.rpd = x <= y ? x : y; S.rph = x <= y ? y : x; S.rp = null; } }
    else if (a === 'rpcsv') { if (S.rp) garzCSV(); }
    else if (a === 'cmhoy') { S.cmd = S.cmh = fechaIso(new Date()); S.cm = null; }
    else if (a === 'cmsem') { const d = new Date(); S.cmh = fechaIso(d); d.setDate(d.getDate() - 6); S.cmd = fechaIso(d); S.cm = null; }
    else if (a === 'cmmes') { const d = new Date(); S.cmh = fechaIso(d); d.setDate(1); S.cmd = fechaIso(d); S.cm = null; }
    else if (a === 'cmver') { const x = $('#cmd').value, y = $('#cmh').value; if (x && y) { S.cmd = x <= y ? x : y; S.cmh = x <= y ? y : x; S.cm = null; } }
    else if (a === 'cmcsv') { if (S.cm) cmCSV(); }
    else if (a === 'opc') { const t = d.o || ''; if (!(S.note || '').split(' · ').includes(t)) S.note = (S.note ? S.note + ' · ' : '') + t; }
    else if (a === 'mover') {
      const to = +S.f['mv-mesa'], ab = abiertas(S.mesa);
      if (!to || !ab.length) { toast('Elige la mesa de destino', 'tk-c'); }
      else if (!puedeCobrarEsta(S.mesa)) alert('Esta mesa la atiende ' + (duenoMesa(S.mesa) || 'otro garzón') + '.');
      else if (!pideOk('¿Mover los pedidos de ' + nm(S.mesa) + ' a ' + nm(to) + '?')) { }
      else if (!fallo(await sb.from('resto_comandas').update({ mesa: to }).in('id', ab.map(c => c.id)))) { toast('Pedidos movidos a ' + nm(to), 'tk-l'); delete S.f['mv-mesa']; S.mesa = to; await cargar(); }
    }
    else if (a === 'cerrar') { S.cerrando = true; S.parcial = false; S.sel = {}; }
    else if (a === 'nocerrar') S.cerrando = false;
    else if (a === 'parcial') { S.parcial = true; S.cerrando = false; S.sel = {}; resetCobro(); }
    else if (a === 'noparcial') { S.parcial = false; S.sel = {}; resetCobro(); }
    else if (a === 'pinc' || a === 'pdec') {
      const c = abiertas(S.mesa).find(x => x.id === d.c), it = c && c.items[+d.i];
      if (it) { const k = d.c + ':' + d.i, v = (S.sel[k] || 0) + (a === 'pinc' ? 1 : -1); if (v > 0) S.sel[k] = Math.min(it.q - (it.pg || 0), v); else delete S.sel[k]; }
    }
    else {
      S.busy = true;
      if (a === 'enviar') {
        const conStock = L().menu.filter(i => S.cart[i.id] && i.s != null).map(i => [i.id, S.cart[i.id]]), vendidos = L().menu.filter(i => S.cart[i.id]).map(i => [i.id, S.cart[i.id]]);
        const items = L().menu.filter(i => S.cart[i.id]).map(i => ({ n: i.n, q: S.cart[i.id], p: i.p, e: i.e }));
        /* una comanda por estación: lo de cocina espera en Cocina; lo de cafetería queda anotado y ya entregado */
        const filas = ['cocina', 'cafeteria'].map(e => items.filter(x => x.e === e)).filter(g => g.length)
          .map(g => ({ id: uid(), local_id: D.id, mesa: S.mesa, items: g, nota: S.note.trim(), garzon: garzonDe(S.mesa) || null, estado: g[0].e === 'cafeteria' ? 'entregado' : 'pendiente', t: Date.now() }));
        if (filas.length) {
          const r = await sb.from('resto_comandas').insert(filas.map(({ t, ...f }) => f));
          if (r && r.error && esRed(r)) {
            OUT.push({ k: 'enviar', filas, stock: conStock, por: S.quien || '', t: Date.now() }); S.sinRed = true; outSave(); outAplicar();
            S.cart = {}; S.note = ''; toast('Sin conexión: pedido guardado, se enviará solo', 'tk-l');
          } else if (!fallo(r)) { for (const [mid, q] of conStock) await sb.rpc('resto_stock_mover', { p_menu: mid, p_delta: -q, p_motivo: 'venta', p_por: S.quien || '', p_log: false }); consumirRecetas(vendidos); S.cart = {}; S.note = ''; }
        }
      } else if (a === 'pagarparte') {
        /* un cliente se retira y paga solo lo suyo: se registra ese pago y esas unidades quedan descontadas de la mesa */
        const pick = [];
        abiertas(S.mesa).forEach(c => c.items.forEach((i, ix) => { const q = Math.min(S.sel[c.id + ':' + ix] || 0, i.q - (i.pg || 0)); if (q > 0) pick.push({ c, ix, q, i }); }));
        if (pick.length) {
          await ensureSes();
          const sub = pick.reduce((s, x) => s + x.q * x.i.p, 0);
          const pe = Math.max(0, Math.round(+S.pe || 0)), pt = S.metodo === 'Tarjeta' ? Math.max(0, Math.round(+S.pt || 0)) : 0;
          const cpp = calcPago(sub);
          const r = await conAut(() => insertarCuenta({ local_id: D.id, mesa: S.mesa, total: cpp.neto, propina: cpp.prop, metodo: S.metodo, garzon: garzonDe(S.mesa) || null, items: pick.map(x => ({ n: x.i.n, q: x.q, p: x.i.p, e: x.i.e })), ...extraCuenta(), ...descCampos(sub), ...peCampos(pe), ...(pt ? { propina_tarj: pt } : {}) }));
          if (!fallo(r)) {
            for (const c of new Set(pick.map(x => x.c))) {
              const items = c.items.map((it, ix) => { const x = pick.find(y => y.c === c && y.ix === ix); return x ? { ...it, pg: (it.pg || 0) + x.q } : it; });
              const lista = items.every(it => (it.pg || 0) >= it.q) && c.estado === 'entregado';
              if (fallo(await sb.from('resto_comandas').update({ items, ...(lista ? { cerrada: true } : {}) }).eq('id', c.id))) break;
            }
            S.parcial = false; S.sel = {}; resetCobro();
          }
        }
      } else if (a === 'pagar') {
        await ensureSes();
        const ab = abiertas(S.mesa), tot = totalMesa(S.mesa);
        const pe = Math.max(0, Math.round(+S.pe || 0)), pt = S.metodo === 'Tarjeta' ? Math.max(0, Math.round(+S.pt || 0)) : 0;
        const restantes = ab.flatMap(c => c.items.map(i => ({ n: i.n, q: i.q - (i.pg || 0), p: i.p, e: i.e })).filter(i => i.q > 0));
        const cpg = calcPago(tot);
        const cuenta = { id: uid(), local_id: D.id, mesa: S.mesa, total: cpg.neto, propina: cpg.prop, metodo: S.metodo, garzon: garzonDe(S.mesa) || null, items: restantes, ...extraCuenta(), ...descCampos(tot), ...peCampos(pe), ...(pt ? { propina_tarj: pt } : {}) };
        const r = tot > 0 ? await conAut(() => insertarCuenta(cuenta)) : {};
        const fin = () => { S.cerrando = false; S.mesa = null; if (S.back) { S.view = S.back; S.back = null; } resetCobro(); };
        if (r && r.error && esRed(r) && !S.desc && !S.aut) {
          OUT.push({ k: 'pagar', cuenta, cids: ab.map(c => c.id), pedido: S.mesa >= 1000 ? S.mesa : 0, t: Date.now() }); S.sinRed = true; outSave(); outAplicar();
          toast('Sin conexión: cobro guardado, se enviará solo', 'tk-l'); fin();
        } else if (!fallo(r)) { fallo(await sb.from('resto_comandas').update({ cerrada: true }).in('id', ab.map(c => c.id))); if (S.mesa >= 1000) await sb.from('resto_pedidos').update({ cerrado: true }).eq('local_id', D.id).eq('num', S.mesa); fin(); }
      } else if (a === 'avanzar') {
        const c = L().comandas.find(x => x.id === d.id);
        const cierra = !!(d.to === 'entregado' && c && pagada(c));
        const r = await sb.from('resto_comandas').update({ estado: d.to, ...(cierra ? { cerrada: true } : {}) }).eq('id', d.id);
        if (r && r.error && esRed(r)) { OUT.push({ k: 'avanzar', id: d.id, to: d.to, cierra, t: Date.now() }); S.sinRed = true; outSave(); outAplicar(); toast('Sin conexión: se enviará solo', 'tk-l'); }
        else fallo(r);
      }
      else if (a === 'anuok') {
        const f = S.an, c = f && abiertas(S.mesa).find(x => x.id === f.c), it = c && c.items.find(x => x.n === f.n);
        if (c && it && puedeVerMesa(S.mesa) && !anuPend(c.id, it.n)) {
          const cant = Math.min(anuLibre(it), Math.max(1, Math.round(+S.f['anu-q'] || 1)));
          const det = (S.f['anu-t'] || '').trim(), motivo = ((S.f['anu-m'] || ANU_MOTIVOS[0]) + (det ? ' · ' + det : '')).slice(0, 200);
          const directo = anuDirecto(c), por = esAdm() ? (S.quien || 'Administradora') : 'Sin autorización (cafetería)';
          const fila = { local_id: D.id, comanda_id: c.id, item_n: it.n, cantidad: cant, precio: it.p, mesa: c.mesa, garzon: c.garzon || (S.rol === 'garzon' ? S.quien : null), estacion: esCafe(c) ? 'cafeteria' : 'cocina', estado_comanda: c.estado, motivo, pedida_por: S.quien || 'Administradora', estado: directo ? 'aprobada' : 'pendiente', ...(directo ? { resuelta_por: por, resuelta_at: ahoraIso() } : {}) };
          const r = await sb.from('resto_anulaciones').insert(fila).select().single();
          if (!fallo(r)) {
            if (directo) await anuAplicar(r.data, por);
            S.an = null; ['anu-q', 'anu-m', 'anu-t'].forEach(k => delete S.f[k]);
            toast(directo ? 'Producto quitado de la cuenta' : 'Solicitud enviada a la administradora', 'tk-l');
          }
        }
      }
      else if (a === 'anuaprobar' && esAdm()) { const x = (D.anulaciones || []).find(y => y.id === d.id && y.estado === 'pendiente'); if (x && await anuAplicar(x, S.quien || 'Administradora')) toast('Anulación aprobada', 'tk-l'); }
      else if (a === 'anurech' && esAdm()) { const x = (D.anulaciones || []).find(y => y.id === d.id && y.estado === 'pendiente'); if (x && !fallo(await sb.from('resto_anulaciones').update({ estado: 'rechazada', resuelta_por: S.quien || 'Administradora', resuelta_at: ahoraIso() }).eq('id', x.id))) toast('Solicitud rechazada', 'tk-l'); }
      else if (a === 'anupinok') {
        const x = (D.anulaciones || []).find(y => y.id === S.anp && y.estado === 'pendiente'), pin = S.f['anu-pin'] || '';
        if (!x) S.anp = null;
        else if ((S.anpN || 0) >= 5) S.anpE = 'Demasiados intentos. Pide a la administradora que la apruebe desde su pantalla.';
        else if (!/^\d{4,8}$/.test(pin) || !D.adminPin) { S.anpN = (S.anpN || 0) + 1; S.anpE = 'PIN incorrecto'; }
        else {
          /* el servidor verifica el PIN de la administradora y entrega un pase de 3 minutos solo para esta autorización */
          const lr = await loginRol('admin', 'admin', pin, true);
          let ok = false, tmp = null;
          if (lr.legacy) ok = (await hpin('admin', pin)) === D.adminPin; else if (lr.ok) { ok = true; tmp = lr.token; }
          if (!ok) { S.anpN = (S.anpN || 0) + 1; S.anpE = lr.error === 'bloqueado' ? msgLogin(lr) : 'PIN incorrecto'; }
          else { const keep = RTOK; if (tmp) RTOK = tmp; let done = false; try { done = await anuAplicar(x, 'Administradora (PIN en el equipo de ' + (S.quien || 'garzón') + ')'); } finally { RTOK = keep; }
            if (done) { S.anpN = 0; S.anp = null; S.anpE = ''; delete S.f['anu-pin']; toast('Anulación autorizada', 'tk-l'); } }
        }
      }
      else if (a === 'mospagar') {
        const sel = L().menu.filter(i => S.cart[i.id]), sub = sel.reduce((a, i) => a + i.p * S.cart[i.id], 0);
        if (sub > 0 && cajaAbierta()) {
          const pe = Math.max(0, Math.round(+S.pe || 0)), pt = S.metodo === 'Tarjeta' ? Math.max(0, Math.round(+S.pt || 0)) : 0;
          await ensureSes();
          const cpm = calcPago(sub);
          const r = await conAut(() => insertarCuenta({ local_id: D.id, mesa: 0, total: cpm.neto, propina: cpm.prop, metodo: S.metodo, garzon: S.rol === 'garzon' ? S.quien : null, items: sel.map(i => ({ n: i.n, q: S.cart[i.id], p: i.p, e: i.e })), ...extraCuenta(), ...descCampos(sub), ...peCampos(pe), ...(pt ? { propina_tarj: pt } : {}) }));
          if (!fallo(r)) {
            for (const i of sel) if (i.s != null) await sb.rpc('resto_stock_mover', { p_menu: i.id, p_delta: -S.cart[i.id], p_motivo: 'venta', p_por: S.quien || '', p_log: false });
            consumirRecetas(sel.map(i => [i.id, S.cart[i.id]]));
            /* lo que lleva preparación va a Cocina como comanda del mostrador (ya pagada), con la observación del cliente.
               Cafetería la preparan los garzones y los productos con código de barras salen empacados: no pasan por cocina. */
            const aCocina = sel.filter(i => i.e !== 'cafeteria' && !i.cb).map(i => ({ n: i.n, q: S.cart[i.id], p: i.p, e: i.e, pg: S.cart[i.id] }));
            if (aCocina.length) fallo(await sb.from('resto_comandas').insert({ local_id: D.id, mesa: 0, items: aCocina, nota: (S.note || '').trim(), garzon: S.rol === 'garzon' ? S.quien : null, estado: 'pendiente' }));
            S.note = '';
            S.mos = false; if (S.back && S.back !== 'mesas') S.view = S.back; S.back = null; S.cart = {}; S.propina = true; resetCobro();
          }
        }
      }
      else if (a === 'crearped') {
        const c = (S.f['np-c'] || '').trim(), t = (S.f['np-t'] || '').trim(), dir = (S.f['np-d'] || '').trim();
        if (!c) alert('Escribe el nombre del cliente.');
        else if (S.np.tipo === 'delivery' && !dir) alert('Escribe la dirección de entrega.');
        else {
          const mx = await sb.from('resto_pedidos').select('num').eq('local_id', D.id).order('num', { ascending: false }).limit(1);
          const num = Math.max(1000, mx.data && mx.data[0] ? mx.data[0].num : 1000) + 1;
          if (!fallo(await sb.from('resto_pedidos').insert({ local_id: D.id, num, tipo: S.np.tipo, cliente: c, telefono: t || null, direccion: dir || null }))) { S.np = null; S.f = {}; S.mesa = num; S.cart = {}; S.note = ''; S.cerrando = false; S.parcial = false; S.sel = {}; resetCobro(); }
        }
      }
      else if (a === 'cancelped') { if (S.mesa >= 1000 && !abiertas(S.mesa).length && !fallo(await sb.from('resto_pedidos').delete().eq('local_id', D.id).eq('num', S.mesa))) S.mesa = null; }
      else if (a === 'tabrir') {
        const tot = dnTotal('a'), mal = dnBad('a');
        if (mal.length) alert('Revisa estos montos, no corresponden a billetes o monedas completos: ' + mal.map(([v, n]) => n).join(', ') + '.');
        else if (!D.turno && (tot > 0 || confirm('No anotaste billetes ni monedas. ¿Abrir la caja con $0 de sencillo?'))) {
          const base = { local_id: D.id, abierto_por: S.quien || 'Administradora', monto_inicial: tot }, desg = dnObj('a');
          let r = await sb.from('resto_turnos').insert({ ...base, desglose_apertura: desg });
          if (r.error && /desglose/i.test(r.error.message || '')) r = await sb.from('resto_turnos').insert({ ...base, nota: 'Sencillo inicial: ' + (dnTxt(desg) || 'sin detalle') });
          if (!fallo(r)) { S.f = {}; S.th = null; }
        }
      }
      else if (['insadd', 'inscompra', 'insuso', 'insmerma', 'inscont', 'insmin', 'insoff'].includes(a) && esAdm()) {
        const mover = (id, delta, motivo, extra) => sb.rpc('resto_insumo_mover', { p_insumo: id, p_delta: delta, p_motivo: motivo, p_por: S.quien || 'Administradora', ...(extra || {}) });
        const it = D.insumos.find(x => x.id === d.id);
        if (a === 'insadd') {
          const n = (S.f['i-n'] || '').trim(), u = S.f['i-u'] || 'un', st = numD('i-s'), mn = numD('i-min');
          if (!n) alert('Escribe el nombre del insumo.');
          else if (D.insumos.some(x => x.on && norm(x.n) === norm(n))) alert('Ya existe un insumo llamado "' + n + '".');
          else if ((st !== null && st < 0) || (mn !== null && mn < 0)) alert('Las cantidades no pueden ser negativas.');
          else {
            const r = await sb.from('resto_insumos').insert({ local_id: D.id, nombre: n, unidad: u, stock: 0, stock_min: mn || 0 }).select().single();
            if (!fallo(r)) {
              if (st > 0 && r.data) fallo(await mover(r.data.id, st, 'conteo', { p_nota: 'Cantidad inicial' }));
              ['i-n', 'i-u', 'i-s', 'i-min'].forEach(k => delete S.f[k]); await cargar(); toast('Insumo agregado · ' + n, 'tk-l');
            }
          }
        }
        else if (a === 'inscompra') {
          const ins = D.insumos.find(x => x.id === S.f['c-ins']), q = numD('c-q'), m = Math.round(+S.f['c-m']), tipo = GTIPOS.includes(S.f['c-tipo']) ? S.f['c-tipo'] : 'Boleta', num = (S.f['c-num'] || '').trim(), prov = (S.f['c-prov'] || '').trim(), caja = S.f['c-pago'] === 'caja';
          if (!ins) alert('Elige el insumo que compraste.');
          else if (!(q > 0)) alert('Escribe la cantidad comprada.');
          else if (!(m > 0)) alert('Escribe el total pagado.');
          else if (tipo !== 'Sin documento' && !num) alert('Escribe el número de la ' + tipo.toLowerCase() + '. Si no hay documento, elige "Sin documento".');
          else if (!prov) alert('Escribe el proveedor.');
          else if (caja && !D.turno) alert('La caja está cerrada: no se puede pagar con dinero de la caja. Elige "Otro medio" o abre la caja.');
          else if (confirm('¿Registrar la compra de ' + fmtQ(q) + ' ' + unTxt(ins.u) + ' de ' + ins.n + ' por ' + money(m) + (caja ? ' pagada con dinero de la caja' : '') + '?')) {
            const r = await mover(ins.id, q, 'compra', { p_costo: m, p_tipo: tipo, p_num: tipo === 'Sin documento' ? null : num, p_prov: prov, p_caja: caja });
            if (!fallo(r)) {
              if (caja) fallo(await sb.from('resto_gastos').insert({ local_id: D.id, turno_id: D.turno.id, tipo, numero: tipo === 'Sin documento' ? null : num, proveedor: prov, detalle: 'Compra de insumo: ' + ins.n + ' (' + fmtQ(q) + ' ' + unTxt(ins.u) + ')', monto: m, registrado_por: S.quien || 'Administradora' }));
              ['c-ins', 'c-q', 'c-m', 'c-tipo', 'c-num', 'c-prov', 'c-pago'].forEach(k => delete S.f[k]); await cargar(); toast('Compra registrada · ' + ins.n, 'tk-l');
            }
          }
        }
        else if (it && (a === 'insuso' || a === 'insmerma' || a === 'inscont' || a === 'insmin')) {
          const q = numD('iq-' + it.id);
          if (q === null || q < 0 || (a !== 'inscont' && a !== 'insmin' && q === 0)) alert('Escribe una cantidad.');
          else if (a === 'insmin') { if (!fallo(await sb.from('resto_insumos').update({ stock_min: q }).eq('id', it.id))) { delete S.f['iq-' + it.id]; await cargar(); } }
          else if ((a === 'insuso' || a === 'insmerma') && q > it.s) alert('No alcanza: solo hay ' + fmtQ(it.s) + ' ' + unTxt(it.u) + ' de ' + it.n + '.');
          else {
            const nota = a === 'insmerma' ? ((prompt('Motivo de la merma (se pierde o vence):') || '').trim() || null) : null;
            const r = await mover(it.id, a === 'inscont' ? q - it.s : -q, a === 'insuso' ? 'uso' : a === 'insmerma' ? 'merma' : 'conteo', nota ? { p_nota: nota } : {});
            if (!fallo(r)) { delete S.f['iq-' + it.id]; await cargar(); }
          }
        }
        else if (it && a === 'insoff') { if (confirm('¿Quitar "' + it.n + '" del inventario de producción? Sus movimientos quedan registrados.')) { if (!fallo(await sb.from('resto_insumos').update({ activo: false }).eq('id', it.id))) await cargar(); } }
      }
      else if (['pvadd', 'pvdel', 'recadd', 'recdel', 'ocnueva', 'ocrec', 'ocanu', 'insvence', 'cgapl'].includes(a) && esAdm()) {
        if (a === 'pvadd') {
          const n = (S.f['pv-n'] || '').trim();
          if (!n) alert('Escribe el nombre del proveedor.');
          else if (!fallo(await sb.from('resto_proveedores').insert({ local_id: D.id, nombre: n, telefono: (S.f['pv-t'] || '').trim() || null, correo: (S.f['pv-m'] || '').trim() || null }))) { ['pv-n', 'pv-t', 'pv-m'].forEach(k => delete S.f[k]); await cargar(); }
        }
        else if (a === 'pvdel') { if (confirm('¿Quitar este proveedor?') && !fallo(await sb.from('resto_proveedores').update({ activo: false }).eq('id', d.id))) await cargar(); }
        else if (a === 'recadd') {
          const m = S.f['r-m'], i = S.f['r-i'], q = numD('r-q');
          if (!m || !i || !(q > 0)) alert('Elige el producto, el insumo y la cantidad.');
          else if (!fallo(await sb.from('resto_recetas').upsert({ local_id: D.id, menu_id: m, insumo_id: i, cantidad: q }, { onConflict: 'menu_id,insumo_id' }))) { ['r-i', 'r-q'].forEach(k => delete S.f[k]); await cargar(); toast('Receta actualizada', 'tk-l'); }
        }
        else if (a === 'recdel') { if (!fallo(await sb.from('resto_recetas').delete().eq('id', d.id))) await cargar(); }
        else if (a === 'ocnueva') {
          const pv = S.f['oc-pv'], bajos = bajoIns();
          if (!pv) alert('Elige el proveedor.');
          else if (!bajos.length) alert('No hay insumos bajo el mínimo.');
          else if (!fallo(await sb.from('resto_ordenes_compra').insert({ local_id: D.id, proveedor: pv, estado: 'pendiente', items: bajos.map(i => ({ insumo_id: i.id, n: i.n, u: unTxt(i.u), q: sugerido(i) })), creada_por: S.quien || 'Administradora' }))) { await cargar(); toast('Orden creada: envíala por WhatsApp o correo', 'tk-l'); }
        }
        else if (a === 'ocrec' || a === 'ocanu') {
          if (confirm(a === 'ocrec' ? '¿Marcar como recibida? Recuerda registrar la compra en Inventario de producción para sumar el stock.' : '¿Anular esta orden?') && !fallo(await sb.from('resto_ordenes_compra').update(a === 'ocrec' ? { estado: 'recibida', recibida_at: new Date().toISOString() } : { estado: 'anulada' }).eq('id', d.id))) await cargar();
        }
        else if (a === 'insvence') {
          const it = D.insumos.find(x => x.id === d.id);
          if (it) { const v = prompt('Fecha de vencimiento de «' + it.n + '» (AAAA-MM-DD). Vacío para quitar:', it.v || ''); if (v !== null) { const f = v.trim(); if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) alert('Usa el formato AAAA-MM-DD, por ejemplo 2026-12-31.'); else if (!fallo(await sb.from('resto_insumos').update({ vence: f || null }).eq('id', it.id))) await cargar(); } }
        }
        else if (a === 'cgapl') {
          const cambios = D.insumos.filter(i => i.on && S.f['cg-' + i.id] !== undefined && String(S.f['cg-' + i.id]).trim() !== '').map(i => ({ i, q: +String(S.f['cg-' + i.id]).replace(',', '.') })).filter(x => !isNaN(x.q) && x.q >= 0 && x.q !== x.i.s);
          if (!cambios.length) alert('No hay diferencias que aplicar.');
          else if (confirm('Se ajustarán ' + cambios.length + ' insumos a lo contado. ¿Aplicar?')) {
            let mal = false;
            for (const c of cambios) { if (fallo(await sb.rpc('resto_insumo_mover', { p_insumo: c.i.id, p_delta: c.q - c.i.s, p_motivo: 'conteo', p_por: S.quien || 'Administradora', p_nota: 'Conteo físico guiado' }))) { mal = true; break; } }
            D.insumos.forEach(i => delete S.f['cg-' + i.id]);
            await cargar(); if (!mal) toast('Conteo aplicado', 'tk-l');
          }
        }
      }
      else if (a === 'rsp' && esAdm()) { S.rsp = d.p; await rsCargar(); }
      else if (a === 'rsxls' && esAdm() && S.rs && S.rs.cur) rsExcel();
      else if (a === 'rspdf' && esAdm()) window.print();
      else if (a === 'rswa' && esAdm() && S.rs && S.rs.A) {
        let num = ''; try { num = localStorage.getItem('resto_wa') || ''; } catch (e) { }
        const v = prompt('Número de WhatsApp al que se envía el resumen (con código de país, ej. 56912345678):', num);
        if (v !== null) { const n = v.replace(/\D/g, ''); try { localStorage.setItem('resto_wa', n); } catch (e) { } window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(rsTexto()), '_blank', 'noopener'); }
      }
      else if (a === 'respaldo' && esAdm()) { try { await respaldo(); toast('Respaldo descargado', 'tk-l'); } catch (e) { alert('No se pudo hacer el respaldo: ' + e.message); } }
      else if (a === 'setfondo' && esAdm()) {
        const raw = String(S.f['fondo-in'] ?? D.fondo ?? '').replace(/\D/g, ''), v = raw ? Math.min(+raw, 100000000) : 0;
        if (!fallo(await sb.from('resto_locales').update({ fondo_caja: v }).eq('id', D.id))) { delete S.f['fondo-in']; toast('Sencillo fijo guardado · ' + money(v), 'tk-l'); }
      }
      else if (a === 'gpedir' && D.turno) {
        const g = (D.gastos || []).find(x => x.id === d.id && x.turno_id === D.turno.id && !x.anul);
        const mot = g ? (prompt('¿Por qué hay que anular este gasto (' + g.tipo + (g.num ? ' N° ' + g.num : '') + ' · ' + money(g.m) + ')? La administradora lo revisará.') || '').trim() : '';
        if (g && mot) { if (!fallo(await sb.from('resto_gastos').update({ anul_pedida_por: S.quien || 'Caja', anul_pedida_motivo: mot }).eq('id', g.id))) toast('Solicitud enviada a la administradora', 'tk-l'); }
      }
      else if (a === 'ganular' && esAdm() && D.turno) {
        const g = (D.gastos || []).find(x => x.id === d.id && x.turno_id === D.turno.id && !x.anul);
        const mot = g ? (prompt('Motivo de la anulación del gasto ' + g.tipo + (g.num ? ' N° ' + g.num : '') + ' por ' + money(g.m) + ' (queda registrado):', g.pedMot || '') || '').trim() : '';
        if (g && mot) { if (!fallo(await sb.from('resto_gastos').update({ anulado: true, anulado_por: S.quien || 'Administradora', anulado_at: new Date().toISOString(), anulado_motivo: mot }).eq('id', g.id))) toast('Gasto anulado · el registro se conserva', 'tk-l'); }
      }
      else if (a === 'pushon' && esAdm()) { try { await pushActivar(); toast('Avisos activados en este equipo', 'tk-l'); } catch (e) { alert('No se pudieron activar los avisos: ' + (e.message || e)); } }
      else if (a === 'pushoff' && esAdm()) { try { await pushApagar(); toast('Avisos desactivados', 'tk-l'); } catch (e) { alert('No se pudieron desactivar los avisos: ' + (e.message || e)); } }
      else if (a === 'cmetodo' && esAdm() && D.turno) {
        const c = D.cuentas.find(x => x.id === d.id && x.t >= +new Date(D.turno.abierto_at));
        const sug = c ? (c.metodo === 'Tarjeta' ? 'Efectivo' : 'Tarjeta') : '';
        const raw = c ? prompt('Forma de pago correcta de ' + (c.mesa > 0 ? nm(c.mesa) : 'Mostrador') + ' (' + money(c.total + c.propina + c.pt) + '). Hoy figura ' + c.metodo + '. Escribe Efectivo, Tarjeta o Transferencia:', sug) : null;
        const x = String(raw || '').trim().toLowerCase(), nuevo = /^e/.test(x) ? 'Efectivo' : /^tar|^tj/.test(x) ? 'Tarjeta' : /^tr/.test(x) ? 'Transferencia' : '';
        if (c && raw !== null && !nuevo) alert('Escribe Efectivo, Tarjeta o Transferencia.');
        else if (c && nuevo === c.metodo) alert('Ese cobro ya figura como ' + c.metodo + '.');
        else if (c && nuevo && c.pt && nuevo !== 'Tarjeta' && !confirm('Este cobro incluía ' + money(c.pt) + ' de propina extra con tarjeta. Al pasarlo a ' + nuevo + ' esa propina extra se quita. ¿Continuar?')) { /* cancelado */ }
        else if (c && nuevo) {
          const mot = (prompt('Motivo de la corrección de ' + c.metodo + ' a ' + nuevo + ' (queda registrado):', 'Se registró con la forma de pago equivocada') || '').trim();
          if (mot && !fallo(await sb.from('resto_cuentas').update({ metodo: nuevo, ...(nuevo !== 'Tarjeta' && c.pt ? { propina_tarj: 0 } : {}), metodo_editado_por: S.quien || 'Administradora', metodo_editado_motivo: mot }).eq('id', c.id))) toast('Cobro corregido · ' + c.metodo + ' → ' + nuevo, 'tk-l');
        }
      }
      else if (a === 'geditar' && esAdm() && D.turno) {
        const g = (D.gastos || []).find(x => x.id === d.id && x.turno_id === D.turno.id && !x.anul);
        const raw = g ? prompt('Monto correcto del gasto ' + g.tipo + (g.num ? ' N° ' + g.num : '') + ' (' + g.prov + '). Hoy figura ' + money(g.m) + ':', g.m) : null;
        const m = raw === null ? 0 : Math.round(+String(raw).replace(/\D/g, ''));
        if (g && raw !== null && !(m > 0)) alert('Escribe un monto mayor a cero.');
        else if (g && m > 0 && m === g.m) alert('Ese ya es el monto del gasto.');
        else if (g && m > 0 && m > 20 * g.m && !confirm('El monto nuevo (' + money(m) + ') es mucho mayor que el actual (' + money(g.m) + '). ¿Es correcto?')) { /* cancelado */ }
        else if (g && m > 0) {
          const mot = (prompt('Motivo de la corrección (queda registrado junto al monto original ' + money(g.mOrig != null ? g.mOrig : g.m) + '):', 'Error al digitar el monto') || '').trim();
          if (mot && !fallo(await sb.from('resto_gastos').update({ monto: m, editado_por: S.quien || 'Administradora', editado_motivo: mot }).eq('id', g.id))) toast('Gasto corregido · ' + money(g.m) + ' → ' + money(m), 'tk-l');
        }
      }
      else if (a === 'gasto' && D.turno) {
        const tipo = GTIPOS.includes(S.f['g-tipo']) ? S.f['g-tipo'] : 'Boleta', num = (S.f['g-num'] || '').trim(), prov = (S.f['g-prov'] || '').trim(), det = (S.f['g-det'] || '').trim(), m = Math.round(+S.f['g-monto']);
        if (tipo !== 'Sin documento' && !num) alert('Escribe el número de la ' + tipo.toLowerCase() + '. Si no hay documento, elige "Sin documento".');
        else if (!prov) alert('Escribe a quién se le pagó (proveedor).');
        else if (!det) alert('Escribe el detalle: qué se compró o pagó.');
        else if (!(m > 0)) alert('Escribe el monto que salió de la caja.');
        else if (confirm('¿Registrar gasto de ' + money(m) + ' (' + tipo + (num ? ' N° ' + num : '') + ' · ' + prov + ')? Después solo la administradora podrá corregir el monto (queda registrado) o anularlo.')) {
          const r = await sb.from('resto_gastos').insert({ local_id: D.id, turno_id: D.turno.id, tipo, numero: tipo === 'Sin documento' ? null : num, proveedor: prov, detalle: det, monto: m, registrado_por: S.quien || 'Administradora' });
          if (!fallo(r)) { ['g-tipo', 'g-num', 'g-prov', 'g-det', 'g-monto'].forEach(k => delete S.f[k]); toast('Gasto registrado · ' + money(m), 'tk-l'); }
        }
      }
      else if (a === 'retiro' && D.turno) {
        const m = Math.round(+S.f['r-monto']), mot = (S.f['r-mot'] || '').trim();
        if (!esAdm()) alert('Solo la administradora puede registrar retiros de la caja.');
        else if (!(m > 0)) alert('Escribe el monto que retiraste de la caja.');
        else if (!mot) alert('Escribe el motivo o destino del retiro.');
        else if (m > Math.max(0, turnoRes(D.turno).esp) && !confirm('El retiro (' + money(m) + ') es mayor que el efectivo que debe haber en caja (' + money(Math.max(0, turnoRes(D.turno).esp)) + '). ¿Registrarlo igual?')) { /* cancelado */ }
        else if (confirm('¿Registrar retiro de ' + money(m) + ' de la caja (' + mot + ')? Se descuenta del efectivo esperado.')) {
          const r = await sb.from('resto_gastos').insert({ local_id: D.id, turno_id: D.turno.id, tipo: 'Retiro', numero: null, proveedor: 'Retiro de efectivo', detalle: mot, monto: m, registrado_por: S.quien || 'Administradora' });
          if (!fallo(r)) { ['r-monto', 'r-mot'].forEach(k => delete S.f[k]); toast('Retiro registrado · ' + money(m), 'tk-l'); }
        }
      }
      else if (a === 'tcerrar' && D.turno) {
        const t = D.turno, r = turnoRes(t), open = D.comandas.filter(x => !x.cerrada).length;
        const ec = dnTotal('c'), tj = numF('ctarj'), tr = numF('ctrans'), nota = (S.f.tnota || '').trim(), mal = dnBad('c').concat(dnBad('d')), dj = dnTotal('d'), fondo = D.fondo || 0, retiro = ec - dj;
        const dEf = ec - r.esp, dTj = tj === null ? 0 : tj - r.tj, dTr = tr === null ? 0 : tr - r.tr;
        if (mal.length) alert('Revisa estos montos, no corresponden a billetes o monedas completos: ' + mal.map(([v, n]) => n).join(', ') + '.');
        else if (tj === null || tr === null) alert('Escribe el total de tarjetas y el de transferencias (0 si no hubo).');
        else if (dj > ec) alert('El sencillo que dejas en caja (' + money(dj) + ') es mayor que el efectivo contado (' + money(ec) + '). Revisa los montos.');
        else if (!dj && !fondo && !confirm('No anotaste el sencillo que queda en caja. ¿Cerrar sin dejar sencillo?')) { /* cancelado */ }
        else if (fondo && dj !== fondo && !nota) alert('El sencillo que queda en caja (' + money(dj) + ') no es el sencillo fijo (' + money(fondo) + '). Déjalo completo o escribe una observación que explique por qué.');
        else if ((dEf || dTj || dTr) && !nota) alert('La caja no cuadra. Escribe una observación que explique la diferencia antes de cerrar.');
        else if (r.pp && !confirm('Propinas a pagar en efectivo desde la caja: ' + money(r.pp) + '\n' + r.propGar.map(o => o.n + ': ' + money(o.m)).join('\n') + '\n\n¿Ya entregaste estas propinas a los garzones? Si no, entrégalas y vuelve a contar el efectivo antes de cerrar.')) { /* cancelado */ }
        else if (corteDe(t) && !confirm('Vas a cerrar la caja SOLO hasta el ' + diaCorte(corteDe(t)) + ' a las 23:59.\n\nSe cierra con ' + r.cuentas + ' cuenta' + (r.cuentas === 1 ? '' : 's') + ' y ventas por ' + money(r.vt) + '.\nTodo lo cobrado, gastado o retirado después pasa a un turno nuevo que parte con ' + money(dj) + ' de sencillo.\n\nEl cierre no se puede deshacer. ¿Continuar?')) { /* cancelado */ }
        else if (!open || confirm('Hay ' + open + ' pedido(s) todavía abiertos en mesas. ¿Cerrar la caja igual?')) {
          const hasta = corteDe(t);
          const base = { cerrado_at: new Date(hasta || Date.now()).toISOString(), cerrado_por: S.quien || 'Administradora', esperado_efectivo: r.esp, contado_efectivo: ec, diferencia: dEf, ventas_total: r.vt, ventas_efectivo: r.ef, ventas_tarjeta: r.tj, ventas_transf: r.tr, propinas: r.pr, cuentas: r.cuentas };
          const des = { efectivo: dnObj('c'), tarjeta: tj, transferencia: tr, dif_tarjeta: dTj, dif_transferencia: dTr }, deja = dnObj('d'), pagoProp = r.propGar.map(o => ({ n: o.n, m: o.m, c: o.c }));
          if (hasta) {
            /* Cierre con fecha de corte: una sola operación en la base (cierra el turno, abre el nuevo y traslada lo posterior) */
            const rr = await sb.rpc('resto_cerrar_turno_corte', { p_turno: t.id, p_corte: base.cerrado_at, p_cierre: { ...base, nota: nota || null, desglose_cierre: des, desglose_deja: deja, retiro_efectivo: retiro, gastos_total: r.gt, propinas_pagadas: r.pp, pago_propinas: pagoProp, monto_nuevo: dj } });
            if (rr.error && /resto_cerrar_turno_corte|schema cache|does not exist/i.test(rr.error.message || '')) alert('Falta ejecutar la migración 025 (cierre con corte) en Supabase. Avisa a Protech.');
            else if (!fallo(rr)) { await sb.from('resto_sesiones').update({ salida: new Date().toISOString() }).eq('turno_id', t.id).is('salida', null); S.ses = null; S.f = {}; S.th = null; toast('Caja cerrada hasta el ' + diaCorte(hasta) + ' · turno nuevo abierto', 'tk-l'); }
          } else {
          let u = await sb.from('resto_turnos').update({ ...base, nota: nota || null, desglose_cierre: des, desglose_deja: deja, retiro_efectivo: retiro, gastos_total: r.gt, propinas_pagadas: r.pp, pago_propinas: pagoProp }).eq('id', t.id);
          if (u.error && /desglose|retiro_efectivo|gastos_total|propinas_pagadas|pago_propinas/i.test(u.error.message || '')) u = await sb.from('resto_turnos').update({ ...base, nota: [t.nota, nota, 'Cierre: ' + (dnTxt(des.efectivo) || 'sin efectivo') + ' · tarjetas ' + money(tj) + ' · transferencias ' + money(tr), 'Quedó en caja: ' + (dnTxt(deja) || 'nada') + ' · efectivo de ventas retirado ' + money(retiro) + (r.gt ? ' · gastos ' + money(r.gt) : '') + (r.rt ? ' · retiros ' + money(r.rt) : ''), r.pp ? 'Propinas pagadas: ' + pagoProp.map(x => x.n + ' ' + money(x.m)).join(', ') : ''].filter(Boolean).join(' | ') }).eq('id', t.id);
          if (!fallo(u)) { await sb.from('resto_sesiones').update({ salida: new Date().toISOString() }).eq('turno_id', t.id).is('salida', null); S.ses = null; S.f = {}; S.th = null; }
          }
        }
      }
      else if (a === 'sk_set' || a === 'sk_add' || a === 'sk_min' || a === 'sk_off') {
        const it = L().menu.find(x => x.id === d.id), raw = S.f[(d.src === 'sqb' ? 'sqb-' : 'sq-') + d.id], q = Math.round(+raw);
        if (it) {
          if (a === 'sk_off') fallo(await sb.from('resto_menu').update({ stock: null }).eq('id', d.id));
          else if (raw === undefined || raw === '' || isNaN(q) || q < 0) alert('Escribe una cantidad.');
          else {
            let r;
            if (a === 'sk_min') r = await sb.from('resto_menu').update({ stock_min: q }).eq('id', d.id);
            else if (a === 'sk_add') r = await sb.rpc('resto_stock_mover', { p_menu: d.id, p_delta: q, p_motivo: 'entrada', p_por: S.quien || '', p_log: true });
            else if (it.s == null) r = await sb.from('resto_menu').update({ stock: q }).eq('id', d.id);
            else r = await sb.rpc('resto_stock_mover', { p_menu: d.id, p_delta: q - it.s, p_motivo: 'conteo', p_por: S.quien || '', p_log: true });
            if (!fallo(r)) { delete S.f['sq-' + d.id]; delete S.f['sqb-' + d.id]; }
          }
        }
      }
      else if (a === 'pr_set') {
        const it = L().menu.find(x => x.id === d.id), raw = S.f['pr-' + d.id], p = Math.round(+raw);
        if (!it || raw === undefined) { /* sin cambios */ }
        else if (raw === '' || isNaN(p) || p <= 0) alert('Escribe un precio válido.');
        else if (p === it.p) { delete S.f['pr-' + d.id]; }
        else if (!fallo(await sb.from('resto_menu').update({ precio: p }).eq('id', d.id))) { delete S.f['pr-' + d.id]; toast('Precio actualizado · ' + it.n + ' · ' + money(p), 'tk-l'); }
      }
      else if (a === 'cb_set') {
        const cb = (S.f['cb-' + d.id] === undefined ? '' : S.f['cb-' + d.id]).trim(), it = L().menu.find(x => x.id === d.id), otro = cb && L().menu.find(x => x.cb === cb && x.id !== d.id);
        if (S.f['cb-' + d.id] === undefined) { /* sin cambios */ }
        else if (otro) alert('Ese código ya pertenece a "' + otro.n + '".');
        else if (it && !fallo(await sb.from('resto_menu').update({ codigo: cb || null }).eq('id', d.id))) { delete S.f['cb-' + d.id]; toast(cb ? 'Código guardado · ' + it.n : 'Código quitado · ' + it.n, 'tk-l'); }
      }
      else if (a === 'cancelcb') { S.nuevo = null; ['nn', 'nc', 'np', 'nq', 'ne'].forEach(k => delete S.f[k]); }
      else if (a === 'crearcb' && S.nuevo) {
        const n = (S.f.nn || '').trim(), c = (S.f.nc || '').trim() || 'General', p = Math.round(+S.f.np || 0), q = S.f.nq === undefined || S.f.nq === '' ? 0 : Math.round(+S.f.nq);
        if (!n || p <= 0) alert('Escribe el nombre y el precio de venta.');
        else if (isNaN(q) || q < 0) alert('La cantidad no es válida.');
        else {
          const r = await sb.from('resto_menu').insert({ local_id: D.id, nombre: n, categoria: c, precio: p, codigo: S.nuevo.cb, stock: q, ...(S.f.ne === 'cafeteria' ? { estacion: 'cafeteria' } : {}) }).select('id').single();
          if (!fallo(r)) {
            if (q > 0 && r.data) await sb.from('resto_stock_mov').insert({ local_id: D.id, menu_id: r.data.id, delta: q, motivo: 'entrada', por: S.quien || '' });
            S.nuevo = null; ['nn', 'nc', 'np', 'nq', 'ne'].forEach(k => delete S.f[k]); toast('Producto creado · ' + n, 'tk-l');
          }
        }
      }
      else if (a === 'rcrear') {
        const f = S.f, fecha = f.rf || hoyIso(), h = f.rh || '', nom = (f.rn || '').trim(), mesa = f.rm ? +f.rm : null;
        if (!h || !nom) alert('Escribe la hora y el nombre.');
        else {
          const mm = x => +x.slice(0, 2) * 60 + +x.slice(3, 5);
          const choca = mesa && L().reservas.some(r => r.estado === 'pendiente' && r.mesa === mesa && r.fecha === fecha && Math.abs(mm(r.hora) - mm(h)) < 120);
          if (!choca || confirm(nm(mesa) + ' ya tiene otra reserva cerca de esa hora. ¿Guardar igual?'))
            if (!fallo(await sb.from('resto_reservas').insert({ local_id: D.id, fecha, hora: h, personas: Math.max(1, Math.round(+f.rp || 2)), nombre: nom, telefono: (f.rt || '').trim() || null, mesa, nota: (f.rnota || '').trim() || null }))) S.f = {};
        }
      }
      else if (a === 'rllego' || a === 'rcancel') fallo(await sb.from('resto_reservas').update({ estado: a === 'rllego' ? 'llego' : 'cancelada' }).eq('id', d.id));
      else if (a === 'setadminpin' && esAdm()) {
        const p = ($('#apin') || {}).value || '';
        if (!/^\d{4,8}$/.test(p)) { alert('El PIN debe tener de 4 a 8 números.'); }
        else {
          let r = await pinSet('admin', 'admin', p);
          if (r.error && sinFuncion(r.error)) { SIN_PASES = true; r = await sb.from('resto_locales').update({ admin_pin: await hpin('admin', p) }).eq('id', D.id); if (!fallo(r)) { S.rol = 'admin'; S.quien = 'Administradora'; guardarRol(D.id, 'admin', 'Administradora', ''); alert('PIN guardado. Desde ahora cada persona entra con su PIN.'); } }
          else if (!fallo(r)) { const lr = await loginRol('admin', 'admin', p); S.rol = 'admin'; S.quien = 'Administradora'; RTOK = lr.ok ? lr.token : ''; guardarRol(D.id, 'admin', 'Administradora', RTOK); alert('PIN guardado. Desde ahora cada persona entra con su PIN.'); }
        }
      }
      else if (a === 'setppct' && esAdm()) {
        const v = Math.round(+($('#ppct') || {}).value);
        if (!(v >= 0 && v <= 30)) alert('La propina debe estar entre 0 y 30%.');
        else if (!fallo(await sb.from('resto_locales').update({ propina_pct: v }).eq('id', D.id))) toast('Propina sugerida: ' + v + '%', 'tk-l');
      }
      else if (a === 'setgpin' && esAdm()) {
        const p = ($('#gp-' + d.id) || {}).value || '';
        if (p && !/^\d{4,8}$/.test(p)) alert('El PIN debe tener de 4 a 8 números.');
        else { const r = await pinSet('garzon', d.id, p); if (r.error && sinFuncion(r.error)) fallo(await sb.from('resto_garzones').update(p ? { pin: await hpin('g:' + d.id, p) } : { pin: null, caja: false }).eq('id', d.id)); else fallo(r); }
      }
      else if (a === 'gcaja' && esAdm()) {
        const g = L().garzones.find(x => x.id === d.id), dar = !(g && g.pin && g.cj);
        if (!g) { /* ya no existe */ }
        else if (dar && !g.pin) alert('Primero asígnale un PIN a ' + g.n + ' y luego autorízalo para cobrar.');
        else fallo(await sb.from('resto_garzones').update({ caja: dar }).eq('id', d.id));
      }
      else if (a === 'quitarpin') {
        if (esAdm() && confirm('¿Desactivar los accesos por PIN? Todos volverán a ver todo.')) { const r = await pinSet('admin', 'admin', ''); if (r.error && sinFuncion(r.error)) fallo(await sb.from('resto_locales').update({ admin_pin: null }).eq('id', D.id)); else fallo(r); }
      }
      else if (a === 'qrtoggle' && esAdm()) { fallo(await sb.from('resto_locales').update({ qr_activo: !L().qr }).eq('id', D.id)); }
      else if (a === 'qrimprimir' && esAdm()) { imprimirQR(); }
      else if (a === 'toggle') { const i = L().menu.find(x => x.id === d.id); if (i) fallo(await sb.from('resto_menu').update({ activo: !i.on }).eq('id', d.id)); }
      else if (a === 'opcedit') { const i = L().menu.find(x => x.id === d.id); if (i) { const v = prompt('Opciones rápidas de «' + i.n + '», separadas por coma (ej: sin cebolla, bien cocido, sin hielo). Vacío para quitar:', i.o); if (v !== null) fallo(await sb.from('resto_menu').update({ opciones: v.trim() || null }).eq('id', d.id)); } }
      else if (a === 'est') { const i = L().menu.find(x => x.id === d.id); if (i) fallo(await sb.from('resto_menu').update({ estacion: i.e === 'cafeteria' ? 'cocina' : 'cafeteria' }).eq('id', d.id)); }
      else if (a === 'cadd' && esAdm()) { const n = ($('#cn') || {}).value.trim(); if (n) fallo(await sb.from('resto_cocineras').insert({ local_id: D.id, nombre: n })); }
      else if (a === 'ctoggle' && esAdm()) { const c = L().cocineras.find(x => x.id === d.id); if (c) fallo(await sb.from('resto_cocineras').update({ activo: !c.on }).eq('id', d.id)); }
      else if (a === 'cdel' && esAdm()) { const c = L().cocineras.find(x => x.id === d.id); if (c && confirm('¿Quitar a ' + c.n + '?')) fallo(await sb.from('resto_cocineras').delete().eq('id', d.id)); }
      else if (a === 'setcpin' && esAdm()) {
        const p = ($('#cp-' + d.id) || {}).value || '';
        if (p && !/^\d{4,8}$/.test(p)) alert('El PIN debe tener de 4 a 8 números.');
        else { const r = await pinSet('cocina', d.id, p); if (r.error && sinFuncion(r.error)) fallo(await sb.from('resto_cocineras').update({ pin: p ? await hpin('c:' + d.id, p) : null }).eq('id', d.id)); else fallo(r); }
      }
      else if (a === 'gadd') { const n = $('#gn').value.trim(); if (n) fallo(await sb.from('resto_garzones').insert({ local_id: D.id, nombre: n })); }
      else if (a === 'gtoggle') { const g = L().garzones.find(x => x.id === d.id); if (g) fallo(await sb.from('resto_garzones').update({ activo: !g.on }).eq('id', d.id)); }
      else if (a === 'gdel') fallo(await sb.from('resto_garzones').delete().eq('id', d.id));
      else if (a === 'del') fallo(await sb.from('resto_menu').delete().eq('id', d.id));
      else if (a === 'add') {
        const n = $('#an').value.trim(), c = $('#ac').value.trim() || 'General', p = +$('#ap').value;
        const est = ($('#ae') || {}).value === 'cafeteria' ? { estacion: 'cafeteria' } : {};
        const cb = (($('#acb') || {}).value || '').trim(), st = (($('#ast') || {}).value || '').trim();
        if (cb && L().menu.some(x => x.cb === cb)) alert('Ese código de barras ya pertenece a "' + L().menu.find(x => x.cb === cb).n + '".');
        else if (n && p > 0) fallo(await sb.from('resto_menu').insert({ local_id: D.id, nombre: n, categoria: c, precio: Math.round(p), ...est, ...(cb ? { codigo: cb } : {}), ...(st !== '' && +st >= 0 ? { stock: Math.round(+st) } : {}) }));
      } else if (a === 'mesas') { const n = Math.min(60, Math.max(1, +$('#nm').value || 1)), n2 = Math.min(30, Math.max(0, Math.round(+$('#nm2').value || 0))); fallo(await sb.from('resto_locales').update({ mesas: n, mesas2: n2 }).eq('id', D.id)); }
      await cargar(); S.busy = false;
      if (pagoInfo && pagoInfo.tp > 0 && !S.lastErr) {
        const x = pagoInfo;
        toast(x.m === 'Efectivo' ? 'Cobrado ' + money(x.tp) + ' en efectivo' + (x.rc != null ? ' · recibido ' + money(x.rc) + ' · VUELTO ' + money(x.rc - x.tp) : '') : 'Cobrado ' + money(x.tp) + (x.m === 'Tarjeta' ? ' con tarjeta' : ' por transferencia'), 'tk-l');
      }
      if (a === 'pagarparte' && S.mesa && !abiertas(S.mesa).length) S.mesa = null;
    }
  } catch (x) { S.busy = false; console.error(x); }
  render();
});
/* Refresco de seguridad (por si el tiempo real se corta): cada 20 s solo lo que cambia durante el servicio, y completo cada 3 minutos. No redibuja si nada cambió. */
let POLLN = 0, ULT = 0;
setInterval(async () => {
  if (!S.user || !D || S.busy || document.hidden) return;
  if (!(S.view === 'cocina' || S.view === 'cafe' || S.view === 'mesas')) return;
  POLLN++; const completo = POLLN % 9 === 0, antes = JSON.stringify(D);
  await cargar(completo ? null : new Set(['com', 'cue', 'ped', 'anu', 'tur']));
  if (!D) { render(); return; }
  if (JSON.stringify(D) !== antes || Date.now() - ULT > 60000) { ULT = Date.now(); render(); }
}, 20000);
inicio();

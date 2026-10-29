// node --test tests/robi.test.js
const test = require('node:test'), assert = require('node:assert');
const { mensaje, svg } = require('../robi.js');
const base = { quien: 'Ana', esperado: { m: 168570, de: 'turno' }, turno: null, apertura: { total: 0, escribio: false } };
const abierto = (res, cierre, t = {}) => ({ ...base, turno: { monto_inicial: 168570, nombre: 'mañana', abierto_h: 3, ...t }, res: { cuentas: 4, vt: 50000, esp: 218570, tj: 0, tr: 0, pp: 0, ...res }, cierre: { escribio: false, ef: 0, tj: null, tr: null, dj: 0, hayD: false, ...cierre } });

test('apertura: saluda con el sencillo a recibir', () => {
  const m = mensaje(base); assert.equal(m.tono, 'hola'); assert.match(m.txt, /Ana/); assert.match(m.txt, /\$168\.570/);
});
test('apertura: avisa la diferencia y celebra cuando coincide', () => {
  assert.match(mensaje({ ...base, apertura: { total: 100000, escribio: true } }).txt, /faltan \$68\.570/);
  assert.equal(mensaje({ ...base, apertura: { total: 168570, escribio: true } }).tono, 'ok');
});
test('abierta sin sencillo registrado: advierte', () => {
  const m = mensaje(abierto({}, {}, { monto_inicial: 0 })); assert.equal(m.tono, 'aviso'); assert.match(m.txt, /sin registrar sencillo/);
});
test('abierta: menciona propinas por pagar y turno largo', () => {
  assert.match(mensaje(abierto({ pp: 12000 }, {})).txt, /paga \$12\.000 de propinas/);
  assert.match(mensaje(abierto({}, {}, { abierto_h: 20 })).txt, /20 horas/);
});
test('cierre: diferencia de efectivo, tarjeta y transferencia', () => {
  assert.match(mensaje(abierto({}, { escribio: true, ef: 200000, tj: 0, tr: 0, hayD: true, dj: 168570 })).txt, /En efectivo faltan \$18\.570/);
  assert.match(mensaje(abierto({ tj: 30000 }, { escribio: true, ef: 218570, tj: 90000, tr: 0, hayD: true, dj: 168570 })).txt, /tarjetas no cuadran: sobran \$60\.000/);
  assert.match(mensaje(abierto({ tr: 5000 }, { escribio: true, ef: 218570, tj: 0, tr: 0, hayD: true, dj: 168570 })).txt, /transferencias no cuadran: faltan \$5\.000/);
});
test('cierre: pide lo que falta y al final dice que todo cuadra', () => {
  assert.match(mensaje(abierto({}, { escribio: true, ef: 218570, tj: 0, tr: 0 })).txt, /sencillo que dejas/);
  const ok = mensaje(abierto({}, { escribio: true, ef: 218570, tj: 0, tr: 0, hayD: true, dj: 168570 }));
  assert.equal(ok.tono, 'ok'); assert.match(ok.txt, /Todo cuadra/); assert.match(ok.txt, /\$168\.570 de sencillo/);
});
test('el sencillo que se deja es libre: cualquier monto sirve y se lo dice al próximo turno', () => {
  const ok = mensaje(abierto({}, { escribio: true, ef: 218570, tj: 0, tr: 0, hayD: true, dj: 150000 }));
  assert.equal(ok.tono, 'ok'); assert.match(ok.txt, /Dejas \$150\.000 de sencillo/);
});
test('apertura: sin turno anterior usa el sencillo de partida', () => {
  assert.match(mensaje({ ...base, esperado: { m: 168570, de: 'partida' } }).txt, /sencillo de partida/);
});
test('abierta: dice si el turno es de la mañana o de la tarde', () => {
  assert.match(mensaje(abierto({}, {}, { nombre: 'tarde' })).txt, /Turno de la tarde/);
});
test('las cifras salen solo de los datos recibidos', () => {
  const m = mensaje(abierto({ cuentas: 1, vt: 1234 }, {})); assert.match(m.txt, /1 cuenta y \$1\.234/);
});
test('svg: cambia la boca según el tono y no trae scripts', () => {
  assert.notEqual(svg('ok', false), svg('mal', false)); assert.ok(!/<script/i.test(svg('ok', true)));
});
test('cobros repetidos: detecta el mismo cobro de una mesa en menos de 3 minutos', () => {
  const { duplicados } = require('../robi.js');
  const it = [{ n: 'Café', q: 2 }], t0 = 1_000_000_000_000;
  const c = (id, dt, extra = {}) => ({ id, mesa: 4, total: 11490, metodo: 'Tarjeta', garzon: 'Ana', items: it, t: t0 + dt, ...extra });
  const r = duplicados([c('a', 0), c('b', 47000)], t0 + 60000);
  assert.equal(r.length, 1); assert.equal(r[0].id, 'dup-b'); assert.equal(r[0].gravedad, 'alta'); assert.match(r[0].detalle, /mesa 4/); assert.match(r[0].detalle, /\$11\.490/); assert.match(r[0].detalle, /47 segundos/);
  // no son repetidos: otra forma de pago, otro monto, otros productos, mesa 0 (mostrador) o más de 3 minutos
  assert.equal(duplicados([c('a', 0), c('b', 47000, { metodo: 'Efectivo' })], t0 + 60000).length, 0);
  assert.equal(duplicados([c('a', 0), c('b', 47000, { total: 5000 })], t0 + 60000).length, 0);
  assert.equal(duplicados([c('a', 0), c('b', 47000, { items: [{ n: 'Té', q: 1 }] })], t0 + 60000).length, 0);
  assert.equal(duplicados([c('a', 0, { mesa: 0 }), c('b', 47000, { mesa: 0 })], t0 + 60000).length, 0);
  assert.equal(duplicados([c('a', 0), c('b', 200000)], t0 + 300000).length, 0);
  // cobros viejos (más de 12 horas) no suenan
  assert.equal(duplicados([c('a', 0), c('b', 47000)], t0 + 13 * 3600000).length, 0);
  // con comandas: dos cafés pedidos en comandas distintas y cobrados por separado NO es repetido; cobrar de más sí
  const cm = (n) => Array.from({ length: n }, () => ({ mesa: 4, items: [{ n: 'Café', q: 2 }], t: t0 - 60000 }));
  assert.equal(duplicados([c('a', 0), c('b', 47000)], t0 + 60000, undefined, undefined, cm(2)).length, 0);
  assert.equal(duplicados([c('a', 0), c('b', 47000)], t0 + 60000, undefined, undefined, cm(1)).length, 1);
});

test('tema mago: del 24/10 al 2/11 Robi es aprendiz de mago; fuera de fechas o con "bruja" se apaga', () => {
  const Real = Date;
  const en = (y, m, d, fn) => { global.Date = class extends Real { constructor(...a) { return a.length ? new Real(...a) : new Real(y, m, d, 12); } }; try { return fn(); } finally { global.Date = Real; } };
  en(2026, 9, 28, () => { assert.ok(require('../robi.js').mago()); const v = svg('ok', false); assert.ok(/robi-mg/.test(v) && !/robi-hw/.test(v) && !/<script/i.test(v)); });
  en(2026, 10, 2, () => assert.ok(require('../robi.js').mago()));
  en(2026, 10, 3, () => { assert.ok(!require('../robi.js').mago()); assert.ok(!/robi-mg|robi-hw/.test(svg('ok', false))); });
  en(2026, 9, 23, () => assert.ok(!require('../robi.js').mago()));
  global.localStorage = { getItem: k => (k === 'pr-robi-tema' ? 'bruja' : null) };
  globalThis.localStorage = global.localStorage;
  try { en(2026, 9, 28, () => { assert.ok(!require('../robi.js').mago()); assert.ok(/robi-hw/.test(svg('ok', false))); }); } finally { delete global.localStorage; }
});

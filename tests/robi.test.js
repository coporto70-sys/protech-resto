// node --test tests/robi.test.js
const test = require('node:test'), assert = require('node:assert');
const { mensaje, svg } = require('../robi.js');
const base = { quien: 'Ana', fondo: 169310, turno: null, apertura: { total: 0, escribio: false } };
const abierto = (res, cierre, t = {}) => ({ ...base, turno: { monto_inicial: 169310, abierto_h: 3, ...t }, res: { cuentas: 4, vt: 50000, esp: 219310, tj: 0, tr: 0, pp: 0, ...res }, cierre: { escribio: false, ef: 0, tj: null, tr: null, dj: 0, hayD: false, ...cierre } });

test('apertura: saluda con el sencillo a recibir', () => {
  const m = mensaje(base); assert.equal(m.tono, 'hola'); assert.match(m.txt, /Ana/); assert.match(m.txt, /\$169\.310/);
});
test('apertura: avisa la diferencia y celebra cuando coincide', () => {
  assert.match(mensaje({ ...base, apertura: { total: 100000, escribio: true } }).txt, /faltan \$69\.310/);
  assert.equal(mensaje({ ...base, apertura: { total: 169310, escribio: true } }).tono, 'ok');
});
test('abierta sin sencillo registrado: advierte', () => {
  const m = mensaje(abierto({}, {}, { monto_inicial: 0 })); assert.equal(m.tono, 'aviso'); assert.match(m.txt, /sin registrar sencillo/);
});
test('abierta: menciona propinas por pagar y turno largo', () => {
  assert.match(mensaje(abierto({ pp: 12000 }, {})).txt, /paga \$12\.000 de propinas/);
  assert.match(mensaje(abierto({}, {}, { abierto_h: 20 })).txt, /20 horas/);
});
test('cierre: diferencia de efectivo, tarjeta y transferencia', () => {
  assert.match(mensaje(abierto({}, { escribio: true, ef: 200000, tj: 0, tr: 0, hayD: true, dj: 169310 })).txt, /En efectivo faltan \$19\.310/);
  assert.match(mensaje(abierto({ tj: 30000 }, { escribio: true, ef: 219310, tj: 90000, tr: 0, hayD: true, dj: 169310 })).txt, /tarjetas no cuadran: sobran \$60\.000/);
  assert.match(mensaje(abierto({ tr: 5000 }, { escribio: true, ef: 219310, tj: 0, tr: 0, hayD: true, dj: 169310 })).txt, /transferencias no cuadran: faltan \$5\.000/);
});
test('cierre: pide lo que falta y al final dice que todo cuadra', () => {
  assert.match(mensaje(abierto({}, { escribio: true, ef: 219310, tj: 0, tr: 0 })).txt, /sencillo que queda/);
  const ok = mensaje(abierto({}, { escribio: true, ef: 219310, tj: 0, tr: 0, hayD: true, dj: 169310 }));
  assert.equal(ok.tono, 'ok'); assert.match(ok.txt, /Todo cuadra/);
});
test('cierre: el sencillo que se deja debe ser el fijo', () => {
  assert.match(mensaje(abierto({}, { escribio: true, ef: 219310, tj: 0, tr: 0, hayD: true, dj: 100000 })).txt, /debería ser \$169\.310 y pusiste \$100\.000/);
});
test('las cifras salen solo de los datos recibidos', () => {
  const m = mensaje(abierto({ cuentas: 1, vt: 1234 }, {})); assert.match(m.txt, /1 cuenta y \$1\.234/);
});
test('svg: cambia la boca según el tono y no trae scripts', () => {
  assert.notEqual(svg('ok', false), svg('mal', false)); assert.ok(!/<script/i.test(svg('ok', true)));
});

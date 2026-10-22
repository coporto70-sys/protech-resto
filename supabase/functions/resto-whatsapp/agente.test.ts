// Pruebas del agente de operaciones (hora de Chile, reglas del vigía y textos de apertura/cierre). Ejecutar con:
//   node --test supabase/functions/resto-whatsapp/agente.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fechaChile, horaChile, inicioDiaChile, rangoDiaChile, sumarDias, pesos, duracion, offsetMin } from "./tiempo.ts";
import { evaluar, textoApertura, textoCierre, textoAviso, type Foto } from "./vigia.ts";

// ---------- Hora de Chile ----------
test("verano (UTC-3): el 22/10/2026 empieza a las 03:00 UTC", () => {
  assert.equal(inicioDiaChile("2026-10-22").toISOString(), "2026-10-22T03:00:00.000Z");
  assert.equal(offsetMin(new Date("2026-10-22T12:00:00Z")), -180);
});
test("invierno (UTC-4): el 1/7/2026 empieza a las 04:00 UTC", () => {
  assert.equal(inicioDiaChile("2026-07-01").toISOString(), "2026-07-01T04:00:00.000Z");
});
test("día de cambio de hora (6/9/2026): el día dura 23 horas", () => {
  const { desde, hasta } = rangoDiaChile("2026-09-06");
  assert.equal((hasta.getTime() - desde.getTime()) / 3600000, 23);
});
test("las 9:00 de Chile (12:00Z) siguen siendo el 22/10", () => {
  const d = new Date("2026-10-22T12:00:00Z");
  assert.equal(fechaChile(d), "2026-10-22");
  assert.equal(horaChile(d), "09:00");
});
test("las 00:30 de Chile del 22/10 (03:30Z) son del 22, no del 21", () => {
  assert.equal(fechaChile(new Date("2026-10-22T03:30:00Z")), "2026-10-22");
  assert.equal(fechaChile(new Date("2026-10-22T02:30:00Z")), "2026-10-21");
});
test("sumarDias cruza fin de mes y de año", () => {
  assert.equal(sumarDias("2026-10-31", 1), "2026-11-01");
  assert.equal(sumarDias("2026-01-01", -1), "2025-12-31");
});
test("formato de pesos y duración", () => {
  assert.equal(pesos(168570), "$168.570");
  assert.equal(pesos(-33085), "-$33.085");
  assert.equal(pesos(null), "$0");
  assert.equal(duracion(45), "45 min");
  assert.equal(duracion(200), "3 h 20 min");
  assert.equal(duracion(120), "2 h");
});

// ---------- Vigía ----------
const AHORA = new Date("2026-10-22T15:00:00Z"); // 12:00 hora de Chile
const L = "local-1";
const foto = (o: Partial<Foto> = {}): Foto => ({
  ahora: AHORA,
  locales: [{ id: L, nombre: "Super Pastel", control_caja: true }],
  turnosAbiertos: [], turnosRecientes: [], revisiones: [], anulacionesPendientes: [], pines: [], alertasControl: [],
  pushPorLocal: { [L]: 2 },
  ...o,
});
const hace = (min: number) => new Date(AHORA.getTime() - min * 60000).toISOString();
const claves = (f: Foto) => evaluar(f).map((a) => a.clave);

test("todo normal: no hay avisos", () => {
  const t = { id: "t1", local_id: L, abierto_por: "Cecilia Romero", abierto_at: hace(180), cerrado_at: null };
  const f = foto({ turnosAbiertos: [t], turnosRecientes: [t], revisiones: [{ turno_id: "t1", fase: "apertura" }] });
  assert.deepEqual(evaluar(f), []);
});

test("caja abierta hace 13 h: aviso medio; hace 20 h: aviso alto (como el cierre que quedó sin hacer el 20/10)", () => {
  const largo = { id: "t2", local_id: L, abierto_por: "Administradora", abierto_at: hace(13 * 60), cerrado_at: null };
  const a = evaluar(foto({ turnosAbiertos: [largo], turnosRecientes: [largo], revisiones: [{ turno_id: "t2", fase: "apertura" }] }));
  assert.equal(a.length, 1);
  assert.equal(a[0].gravedad, "media");
  assert.equal(a[0].clave, "turno_largo:t2");
  const sin = { ...largo, abierto_at: hace(20 * 60) };
  const b = evaluar(foto({ turnosAbiertos: [sin], turnosRecientes: [sin], revisiones: [{ turno_id: "t2", fase: "apertura" }] }));
  assert.equal(b[0].gravedad, "alta");
  assert.equal(b[0].clave, "turno_sin_cerrar:t2");
  assert.deepEqual(b[0].para, ["ingeniero", "admin"]);
});

test("anulación: avisa recién a los 10 minutos y solo a la administradora", () => {
  const an = (m: number) => ({ id: "a1", local_id: L, item_n: "Café", cantidad: 2, mesa: 4, pedida_por: "Pedro Lozano", created_at: hace(m) });
  assert.deepEqual(claves(foto({ anulacionesPendientes: [an(9)] })), []);
  const r = evaluar(foto({ anulacionesPendientes: [an(12)] }));
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].para, ["admin"]);
  assert.match(r[0].detalle, /Pedro Lozano pide anular 2× Café \(mesa 4\)/);
});

test("PIN bloqueado: avisa sin revelar de quién es la clave", () => {
  const r = evaluar(foto({ pines: [{ local_id: L, fallos: 5, bloqueado_hasta: new Date(AHORA.getTime() + 600000).toISOString() }] }));
  assert.equal(r.length, 1);
  assert.equal(r[0].gravedad, "alta");
  assert.match(r[0].detalle, /5 intentos fallidos/);
  assert.match(r[0].detalle, /bloqueada/);
});

test("alerta alta del control de caja sin ver: solo después de 30 min", () => {
  const al = (m: number, visto: string | null = null) => ({ id: "x1", local_id: L, gravedad: "alta" as const, titulo: "Caja abierta sin sencillo", detalle: "El turno no tiene sencillo.", created_at: hace(m), visto_at: visto });
  assert.deepEqual(claves(foto({ alertasControl: [al(10)] })), []);
  assert.deepEqual(claves(foto({ alertasControl: [al(45)] })), ["ctrl_sin_ver:x1"]);
  assert.deepEqual(claves(foto({ alertasControl: [al(45, hace(5))] })), []);
});

test("salud: apertura y cierre sin revisión del control de caja avisan solo al ingeniero", () => {
  const t = { id: "t3", local_id: L, abierto_por: "Cecilia Romero", abierto_at: hace(60), cerrado_at: hace(10) };
  const r = evaluar(foto({ turnosRecientes: [t] }));
  assert.deepEqual(r.map((x) => x.clave).sort(), ["sin_revision:t3:apertura", "sin_revision:t3:cierre"]);
  assert.ok(r.every((x) => x.para.length === 1 && x.para[0] === "ingeniero"));
});

test("salud: no avisa si el local no tiene control de caja, ni si la revisión es muy reciente", () => {
  const t = { id: "t4", local_id: L, abierto_por: "X", abierto_at: hace(60), cerrado_at: null };
  assert.deepEqual(claves(foto({ locales: [{ id: L, nombre: "Otro", control_caja: false }], turnosRecientes: [t], pushPorLocal: {} })), []);
  const nuevo = { ...t, abierto_at: hace(2) };
  assert.deepEqual(claves(foto({ turnosRecientes: [nuevo] })), []);
});

test("sin celulares con push: aviso una vez al día", () => {
  const r = evaluar(foto({ pushPorLocal: {} }));
  assert.equal(r.length, 1);
  assert.equal(r[0].clave, `sin_push:${L}:2026-10-22`);
});

// ---------- Textos ----------
test("texto de apertura correcta", () => {
  const t = textoApertura("Super Pastel", { abierto_por: "Cecilia Romero", abierto_at: "", monto_inicial: 168570 }, "09:00", { listo: true, alertas: [] });
  assert.equal(t.titulo, "Caja abierta · Super Pastel");
  assert.match(t.cuerpo, /Cecilia Romero abrió la caja a las 09:00 con \$168\.570/);
  assert.match(t.cuerpo, /sin alertas/);
});

test("texto de apertura con alertas", () => {
  const t = textoApertura("Super Pastel", { abierto_por: "Pedro", abierto_at: "", monto_inicial: 0 }, "16:50", {
    listo: true, alertas: [{ gravedad: "alta", titulo: "Caja abierta sin sencillo" }],
  });
  assert.match(t.cuerpo, /1 alerta \(1 alta\)/);
  assert.match(t.cuerpo, /• Caja abierta sin sencillo/);
});

test("texto de cierre con faltante (caso 19/10: falta $78.910)", () => {
  const t = textoCierre("Super Pastel", {
    abierto_por: "Carlos Oporto", abierto_at: "", monto_inicial: 0, cerrado_por: "Administradora", cerrado_at: "",
    ventas_total: 1614190, cuentas: 179, ventas_tarjeta: 1375460, ventas_transf: 0,
    esperado_efectivo: 413000, contado_efectivo: 334090, diferencia: -78910,
  }, "21:19", { listo: false, alertas: [] });
  assert.match(t.cuerpo, /Ventas \$1\.614\.190 en 179 cuentas/);
  assert.match(t.cuerpo, /Faltan \$78\.910/);
  assert.match(t.cuerpo, /aún revisando/);
});

test("texto de aviso del vigía", () => {
  const s = textoAviso({ local_id: L, clave: "k", gravedad: "alta", titulo: "Caja sin cerrar", detalle: "Lleva 20 h abierta.", para: ["admin"] }, "Super Pastel");
  assert.equal(s, "🔴 Caja sin cerrar · Super Pastel\nLleva 20 h abierta.");
});

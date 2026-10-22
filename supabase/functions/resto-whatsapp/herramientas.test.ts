// Pruebas del agente de operaciones con una base de datos y una IA simuladas (no tocan nada real). Ejecutar con:
//   node --import ./supabase/functions/resto-whatsapp/pruebas/registrar.mjs --test supabase/functions/resto-whatsapp/herramientas.test.ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ejecutar, herramientasPara } from "./herramientas.ts";
import { atenderEquipo, eventoTurno, notificarEquipo, vigiar } from "./operaciones.ts";

const T: Record<string, any[]> = (globalThis as any).__TABLAS;
const L1 = "local-sp", L2 = "local-otro";
const hace = (min: number) => new Date(Date.now() - min * 60000).toISOString();

const ingeniero: any = { id: "m-ing", local_id: null, telefono: "56911111111", nombre: "Carlos", rol: "ingeniero", avisos: "todo" };
const admin: any = { id: "m-adm", local_id: L1, telefono: "56922222222", nombre: "Administradora", rol: "admin", avisos: "importantes" };

// fetch simulado: anota cada llamada y entrega las respuestas de Claude que se le programen
let llamadas: { url: string; body: any }[] = [];
let colaClaude: any[] = [];
globalThis.fetch = (async (url: any, init: any) => {
  const body = init?.body ? JSON.parse(init.body) : null;
  llamadas.push({ url: String(url), body });
  if (String(url).includes("api.anthropic.com")) {
    const r = colaClaude.shift() ?? { content: [{ type: "text", text: "(sin respuesta programada)" }], stop_reason: "end_turn" };
    return { ok: true, status: 200, json: async () => r } as any;
  }
  return { ok: true, status: 200, json: async () => ({}) } as any;
}) as any;
const wa = () => llamadas.filter((l) => l.url.includes("graph.facebook.com") && l.body?.type);
const waTexto = () => wa().filter((l) => l.body.type === "text");

beforeEach(() => {
  for (const k of Object.keys(T)) delete T[k];
  llamadas = []; colaClaude = [];
  T.resto_locales = [
    { id: L1, nombre: "Super Pastel", control_caja: true, tramo: 2 },
    { id: L2, nombre: "Café Otro", control_caja: false, tramo: 4 },
  ];
  T.resto_wa_config = [{ local_id: L1, phone_number_id: "pn1", token: "tok", activo: true, plantilla_aviso: null }];
  T.resto_wa_equipo = [{ ...ingeniero, activo: true }, { ...admin, activo: true }];
  T.resto_push_config = [{ clave: "url", valor: "http://push.test/enviar" }, { clave: "secreto", valor: "sec" }];
  T.resto_push_subs = [{ id: "p1", local_id: L1 }];
});

// ---------- Alcance por rol ----------
test("la administradora solo ve su local, aunque pida otro por nombre", async () => {
  T.resto_turnos = [{ id: "t-otro", local_id: L2, abierto_por: "Intruso", abierto_at: hace(60), cerrado_at: null, monto_inicial: 1 }];
  const r: any = await ejecutar("estado_caja", { local: "Café Otro" }, admin);
  assert.equal(r.local, "Super Pastel");
  assert.equal(r.caja_abierta, false);
});

test("la administradora no puede listar locales ni resolver propuestas, y esas herramientas ni se le ofrecen", async () => {
  assert.match(String(((await ejecutar("locales", {}, admin)) as any).error), /Solo el ingeniero/);
  T.resto_agente_propuestas = [{ id: "pr1", titulo: "x", detalle: "y", estado: "pendiente" }];
  assert.match(String(((await ejecutar("resolver_propuesta", { id: "pr1", estado: "aprobada" }, admin)) as any).error), /Solo el ingeniero/);
  assert.equal(T.resto_agente_propuestas[0].estado, "pendiente");
  const nombres = herramientasPara(admin).map((h) => h.name);
  assert.ok(!nombres.includes("locales") && !nombres.includes("resolver_propuesta"));
  assert.ok(herramientasPara(ingeniero).map((h) => h.name).includes("locales"));
});

test("el ingeniero con varios locales debe indicar cuál; con el nombre funciona", async () => {
  const sin: any = await ejecutar("estado_caja", {}, ingeniero);
  assert.match(sin.error, /varios locales/);
  const con: any = await ejecutar("estado_caja", { local: "otro" }, ingeniero);
  assert.equal(con.local, "Café Otro");
});

test("herramienta desconocida", async () => {
  assert.match(String(((await ejecutar("borrar_todo", {}, ingeniero)) as any).error), /desconocida|Hay varios/);
  assert.match(String(((await ejecutar("borrar_todo", {}, admin)) as any).error), /desconocida/);
});

// ---------- Datos ----------
test("estado de caja: ventas por forma de pago, gastos, retiros y efectivo esperado", async () => {
  T.resto_turnos = [{ id: "t1", local_id: L1, abierto_por: "Cecilia Romero", abierto_at: hace(180), cerrado_at: null, monto_inicial: 168570 }];
  T.resto_cuentas = [
    { turno_id: "t1", local_id: L1, total: 2000, metodo: "Tarjeta", propina: 0, descuento: 0, cobrado_por: "Cecilia Romero", created_at: hace(100), mesa: 0 },
    { turno_id: "t1", local_id: L1, total: 10000, metodo: "Efectivo", propina: 900, descuento: 0, cobrado_por: "Cecilia Romero", created_at: hace(50), mesa: 3 },
    { turno_id: "t-viejo", local_id: L1, total: 99999, metodo: "Efectivo", created_at: hace(5000) },
  ];
  T.resto_gastos = [
    { turno_id: "t1", local_id: L1, tipo: "Boleta", monto: 3000, anulado: false, detalle: "Queso", registrado_por: "Cecilia Romero", created_at: hace(40) },
    { turno_id: "t1", local_id: L1, tipo: "Retiro", monto: 5000, anulado: false, detalle: "Depósito", registrado_por: "Administradora", created_at: hace(30) },
    { turno_id: "t1", local_id: L1, tipo: "Boleta", monto: 9999, anulado: true, detalle: "Anulado", created_at: hace(20) },
  ];
  T.resto_sesiones = [{ turno_id: "t1", usuario: "Cecilia Romero", rol: "garzon", entrada: hace(180), salida: null }];
  const r: any = await ejecutar("estado_caja", {}, admin);
  assert.equal(r.caja_abierta, true);
  assert.equal(r.abierta_por, "Cecilia Romero");
  assert.equal(r.cuentas_cobradas, 2);
  assert.equal(r.cobrado_total_incluye_propinas, "$12.000");
  assert.deepEqual(r.por_forma_de_pago, { efectivo: "$10.000", tarjeta: "$2.000", transferencia: "$0" });
  assert.equal(r.gastos_pagados_de_caja, "$3.000");
  assert.equal(r.retiros_de_efectivo, "$5.000");
  assert.equal(r.efectivo_esperado_aproximado, "$170.570"); // 168.570 + 10.000 − 3.000 − 5.000
  assert.equal(r.cobros_por_persona["Cecilia Romero"], "2 cobros · $12.000");
});

test("caja cerrada: muestra el último cierre con la diferencia", async () => {
  T.resto_turnos = [
    { id: "a", local_id: L1, abierto_por: "X", abierto_at: "2026-10-18T13:00:00.000Z", cerrado_at: "2026-10-18T23:00:00.000Z", cerrado_por: "Y", ventas_total: 100, diferencia: 0 },
    { id: "b", local_id: L1, abierto_por: "Carlos Oporto", abierto_at: "2026-10-19T12:12:00.000Z", cerrado_at: "2026-10-20T00:22:00.000Z", cerrado_por: "Administradora", ventas_total: 1614190, cuentas: 179, esperado_efectivo: 413000, contado_efectivo: 334090, diferencia: -78910 },
  ];
  const r: any = await ejecutar("estado_caja", {}, admin);
  assert.equal(r.caja_abierta, false);
  assert.equal(r.ultimo_cierre.diferencia, "faltan $78.910");
  assert.equal(r.ultimo_cierre.ventas, "$1.614.190");
});

test("ventas: respeta la hora de Chile (23:30 del 21 cuenta para el 21, 00:30 del 22 para el 22)", async () => {
  T.resto_cuentas = [
    { local_id: L1, total: 1000, metodo: "Efectivo", propina: 0, descuento: 0, created_at: "2026-10-22T02:30:00.000Z" },
    { local_id: L1, total: 2000, metodo: "Tarjeta", propina: 100, descuento: 50, created_at: "2026-10-22T03:30:00.000Z" },
    { local_id: L2, total: 777777, metodo: "Efectivo", created_at: "2026-10-22T03:30:00.000Z" },
  ];
  const rango: any = await ejecutar("ventas", { desde: "2026-10-21", hasta: "2026-10-22" }, admin);
  assert.equal(rango.cuentas, 2);
  assert.equal(rango.cobrado_total_incluye_propinas, "$3.000");
  assert.deepEqual(rango.por_dia, { "2026-10-21": "1 cuentas · $1.000", "2026-10-22": "1 cuentas · $2.000" });
  const dia: any = await ejecutar("ventas", { desde: "2026-10-22" }, admin);
  assert.equal(dia.cuentas, 1);
  assert.equal(dia.descuentos, "$50");
  assert.match(String(((await ejecutar("ventas", { desde: "2026-01-01", hasta: "2026-12-31" }, admin)) as any).error), /máximo/);
});

test("pendientes y actividad solo traen datos del local de la administradora", async () => {
  T.resto_anulaciones = [
    { local_id: L1, estado: "pendiente", item_n: "Café", cantidad: 2, mesa: 4, pedida_por: "Pedro Lozano", created_at: hace(12) },
    { local_id: L2, estado: "pendiente", item_n: "Secreto", cantidad: 1, mesa: 1, pedida_por: "Otro", created_at: hace(12) },
  ];
  T.resto_bitacora = [
    { local_id: L1, at: hace(30), quien: "Administradora", rol: "admin", tabla: "resto_gastos", accion: "UPDATE", fila: "Queso", detalle: { monto: { antes: 1000000, despues: 100000 } } },
    { local_id: L2, at: hace(30), quien: "Otro", rol: "admin", tabla: "resto_gastos", accion: "INSERT", fila: "Ajeno", detalle: {} },
  ];
  const p: any = await ejecutar("pendientes", {}, admin);
  assert.equal(p.anulaciones_de_productos.length, 1);
  assert.match(p.anulaciones_de_productos[0], /Pedro Lozano pide anular 2× Café · Mesa 4/);
  const a: any = await ejecutar("actividad", { horas: 2 }, admin);
  assert.equal(a.registros.length, 1);
  assert.match(a.registros[0].detalle, /1000000/);
});

test("propuestas: la administradora guarda y el ingeniero resuelve", async () => {
  const g: any = await ejecutar("proponer_mejora", { titulo: "Aviso de cierre", detalle: "Quiero un resumen diario" }, admin);
  assert.equal(g.ok, true);
  assert.equal(T.resto_agente_propuestas[0].local_id, L1);
  assert.equal(T.resto_agente_propuestas[0].propuesta_por, "Administradora");
  const id = T.resto_agente_propuestas[0].id;
  const res: any = await ejecutar("resolver_propuesta", { id, estado: "aprobada" }, ingeniero);
  assert.equal(res.ok, true);
  assert.equal(T.resto_agente_propuestas[0].estado, "aprobada");
  const lista: any = await ejecutar("ver_propuestas", {}, ingeniero);
  assert.equal(lista.propuestas.length, 1);
});

// ---------- Avisos al equipo ----------
test("fuera de las 24 h de WhatsApp: sin plantilla no se envía; con plantilla se envía como plantilla", async () => {
  const sin = await notificarEquipo({ localId: L1, para: ["ingeniero", "admin"], texto: "Hola\nmundo", nivel: "importante" });
  assert.deepEqual(sin, { enviados: 0, sin_canal: 2 });
  assert.equal(wa().length, 0);
  T.resto_wa_config[0].plantilla_aviso = "aviso_resto";
  const con = await notificarEquipo({ localId: L1, para: ["ingeniero", "admin"], texto: "Hola\nmundo", nivel: "importante" });
  assert.equal(con.enviados, 2);
  assert.equal(wa()[0].body.type, "template");
  assert.equal(wa()[0].body.template.name, "aviso_resto");
  assert.equal(wa()[0].body.template.components[0].parameters[0].text, "Hola · mundo"); // sin saltos de línea
});

test("dentro de las 24 h se manda texto normal, y las administradoras de otro local no reciben nada", async () => {
  T.resto_wa_equipo.push({ id: "m-ajena", local_id: L2, telefono: "56933333333", nombre: "Ajena", rol: "admin", avisos: "todo", activo: true });
  T.resto_agente_msgs = [
    { telefono: ingeniero.telefono, autor: "equipo", texto: "hola", created_at: hace(60) },
    { telefono: admin.telefono, autor: "equipo", texto: "hola", created_at: hace(600) },
    { telefono: "56933333333", autor: "equipo", texto: "hola", created_at: hace(60) },
  ];
  const r = await notificarEquipo({ localId: L1, para: ["ingeniero", "admin"], texto: "Aviso", nivel: "importante" });
  assert.equal(r.enviados, 2);
  assert.deepEqual(waTexto().map((l) => l.body.to).sort(), ["56911111111", "56922222222"]);
});

// ---------- Vigía ----------
test("el vigía avisa una vez una caja sin cerrar y no se repite", async () => {
  T.resto_turnos = [{ id: "t9", local_id: L1, abierto_por: "Administradora", abierto_at: hace(20 * 60), cerrado_at: null }];
  T.resto_control_revisiones = [{ turno_id: "t9", fase: "apertura" }];
  T.resto_agente_msgs = [
    { telefono: ingeniero.telefono, autor: "equipo", texto: "hola", created_at: hace(10) },
    { telefono: admin.telefono, autor: "equipo", texto: "hola", created_at: hace(10) },
  ];
  const r1: any = await vigiar();
  assert.equal(r1.nuevos, 1);
  assert.equal(r1.enviados, 2);
  assert.match(waTexto()[0].body.text.body, /🔴 Caja sin cerrar · Super Pastel/);
  assert.ok(llamadas.some((l) => l.url === "http://push.test/enviar"), "también avisa por push a las administradoras");
  const antes = llamadas.length;
  const r2: any = await vigiar();
  assert.equal(r2.nuevos, 0);
  assert.equal(llamadas.length, antes, "la segunda pasada no manda nada");
  assert.equal(T.resto_agente_avisos.length, 1);
  assert.equal(T.resto_agente_avisos[0].enviados_wa, 2);
});

test("el vigía detecta que el control de caja no revisó un cierre y avisa solo al ingeniero", async () => {
  T.resto_turnos = [{ id: "t8", local_id: L1, abierto_por: "Pedro", abierto_at: hace(300), cerrado_at: hace(20) }];
  T.resto_control_revisiones = [{ turno_id: "t8", fase: "apertura" }];
  T.resto_agente_msgs = [{ telefono: ingeniero.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }, { telefono: admin.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }];
  const r: any = await vigiar();
  assert.equal(r.nuevos, 1);
  assert.deepEqual(waTexto().map((l) => l.body.to), ["56911111111"]);
  assert.ok(!llamadas.some((l) => l.url === "http://push.test/enviar"), "un fallo técnico no se manda como push a la administradora");
});

// ---------- Aperturas y cierres ----------
test("apertura correcta: avisa por push y por WhatsApp solo a quien pidió 'todo'", async () => {
  T.resto_turnos = [{ id: "ap1", local_id: L1, abierto_por: "Cecilia Romero", abierto_at: "2026-10-22T12:00:00.000Z", cerrado_at: null, monto_inicial: 168570 }];
  T.resto_control_revisiones = [{ turno_id: "ap1", fase: "apertura", n_alertas: 0 }];
  T.resto_agente_msgs = [{ telefono: ingeniero.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }, { telefono: admin.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }];
  const r: any = await eventoTurno("apertura", "ap1");
  assert.equal(r.enviados, 1);
  const msg = waTexto()[0].body;
  assert.equal(msg.to, "56911111111");
  assert.match(msg.text.body, /🟢 Caja abierta · Super Pastel/);
  assert.match(msg.text.body, /Cecilia Romero abrió la caja a las 09:00 con \$168\.570/);
  assert.match(msg.text.body, /sin alertas/);
  const push = llamadas.find((l) => l.url === "http://push.test/enviar")!;
  assert.equal(push.body.titulo, "Caja abierta · Super Pastel");
  const antes = llamadas.length;
  assert.equal(((await eventoTurno("apertura", "ap1")) as any).repetido, true);
  assert.equal(llamadas.length, antes, "pedirlo dos veces no duplica el aviso");
});

test("apertura con alerta alta: le llega también a quien solo quiere lo importante", async () => {
  T.resto_turnos = [{ id: "ap2", local_id: L1, abierto_por: "Pedro Lozano", abierto_at: hace(1), cerrado_at: null, monto_inicial: 0 }];
  T.resto_control_revisiones = [{ turno_id: "ap2", fase: "apertura", n_alertas: 1 }];
  T.resto_control_alertas = [{ turno_id: "ap2", fase: "apertura", gravedad: "alta", titulo: "Caja abierta sin sencillo" }];
  T.resto_agente_msgs = [{ telefono: ingeniero.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }, { telefono: admin.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }];
  const r: any = await eventoTurno("apertura", "ap2");
  assert.equal(r.enviados, 2);
  assert.match(waTexto()[0].body.text.body, /1 alerta \(1 alta\)/);
});

test("cierre: resume ventas y diferencia; un local sin control de caja no genera avisos", async () => {
  T.resto_turnos = [
    { id: "ci1", local_id: L1, abierto_por: "Carlos Oporto", abierto_at: hace(600), cerrado_at: "2026-10-22T00:22:00.000Z", cerrado_por: "Administradora", ventas_total: 1614190, cuentas: 179, ventas_tarjeta: 1375460, ventas_transf: 0, esperado_efectivo: 413000, contado_efectivo: 334090, diferencia: -78910, monto_inicial: 0 },
    { id: "ci2", local_id: L2, abierto_por: "Z", abierto_at: hace(600), cerrado_at: hace(1), monto_inicial: 0 },
  ];
  T.resto_control_revisiones = [{ turno_id: "ci1", fase: "cierre", n_alertas: 0 }];
  T.resto_agente_msgs = [{ telefono: ingeniero.telefono, autor: "equipo", texto: "hola", created_at: hace(10) }];
  const r: any = await eventoTurno("cierre", "ci1");
  assert.equal(r.enviados, 1);
  assert.match(waTexto()[0].body.text.body, /Faltan \$78\.910/);
  assert.match(waTexto()[0].body.text.body, /21:22|21:2\d/); // 00:22Z = 21:22 en Chile
  const o: any = await eventoTurno("cierre", "ci2");
  assert.ok(o.omitido);
});

// ---------- Conversación con Claude ----------
test("el agente consulta una herramienta, entrega el resultado a Claude y responde por WhatsApp", async () => {
  T.resto_turnos = [{ id: "t1", local_id: L1, abierto_por: "Cecilia Romero", abierto_at: hace(60), cerrado_at: null, monto_inicial: 168570 }];
  colaClaude = [
    { content: [{ type: "text", text: "Reviso." }, { type: "tool_use", id: "tu1", name: "estado_caja", input: {} }], stop_reason: "tool_use" },
    { content: [{ type: "text", text: "La caja está abierta desde hace 1 h por Cecilia." }], stop_reason: "end_turn" },
  ];
  await atenderEquipo(T.resto_wa_config[0], admin, "¿cómo va la caja?", "wamid.1");
  const claudeCalls = llamadas.filter((l) => l.url.includes("api.anthropic.com"));
  assert.equal(claudeCalls.length, 2);
  assert.ok(!claudeCalls[0].body.tools.some((t: any) => t.name === "locales"), "a la administradora no se le ofrece la herramienta de locales");
  assert.match(claudeCalls[0].body.system, /Administradora/);
  const resultado = claudeCalls[1].body.messages.at(-1).content[0];
  assert.equal(resultado.type, "tool_result");
  assert.match(resultado.content, /Cecilia Romero/);
  assert.deepEqual(waTexto().map((l) => l.body.text.body), ["La caja está abierta desde hace 1 h por Cecilia."]);
  assert.equal(T.resto_agente_msgs.filter((m) => m.autor === "agente").length, 1);
  // el mismo mensaje reenviado por Meta no se responde dos veces
  await atenderEquipo(T.resto_wa_config[0], admin, "¿cómo va la caja?", "wamid.1");
  assert.equal(waTexto().length, 1);
});

test("si falla la IA, el agente avisa con un mensaje claro en vez de quedarse mudo", async () => {
  globalThis.__ENV_BACKUP = (globalThis as any).__ENV.ANTHROPIC_API_KEY;
  delete (globalThis as any).__ENV.ANTHROPIC_API_KEY;
  try {
    await atenderEquipo(T.resto_wa_config[0], ingeniero, "hola", "wamid.2");
    assert.match(waTexto()[0].body.text.body, /ANTHROPIC_API_KEY/);
  } finally {
    (globalThis as any).__ENV.ANTHROPIC_API_KEY = globalThis.__ENV_BACKUP;
  }
});

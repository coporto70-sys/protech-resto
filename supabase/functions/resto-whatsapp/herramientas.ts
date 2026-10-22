// Herramientas que el agente de operaciones puede usar. Todas son de SOLO LECTURA sobre el sistema,
// salvo guardar o resolver propuestas de mejora (que no cambian nada del local: son una lista de pendientes).
// Cada herramienta queda limitada al local de la persona: una administradora nunca ve otro local.
import { db } from "./wa.ts";
import { duracion, fechaChile, fechaHoraCorta, horaChile, pesos, rangoDiaChile, sumarDias } from "./tiempo.ts";

export interface Miembro { id: string; local_id: string | null; telefono: string; nombre: string; rol: "ingeniero" | "admin"; avisos: string }
interface Local { id: string; name: string; control_caja: boolean; tramo?: number }

const MAX_DIAS = 31;
const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const num = (x: unknown) => Math.round(Number(x) || 0);
const suma = (xs: unknown[]) => xs.reduce<number>((a, x) => a + num(x), 0);

export const mesaTxt = (m: number) => m === 0 ? "Venta mostrador" : m >= 1000 ? `Pedido #${m - 1000}` : m > 100 ? `Piso 2 · Mesa ${m - 100}` : `Mesa ${m}`;

/** Trae todas las filas de una consulta aunque pasen de las 1000 que entrega la base por vez. */
async function todas<T>(armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>, maximo = 5000): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maximo; i += 1000) {
    const { data, error } = await armar(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function resolverLocal(m: Miembro, input: any): Promise<{ local: Local } | { error: string }> {
  const cols = "id,name,control_caja,tramo";
  if (m.rol === "admin") {
    if (!m.local_id) return { error: "Tu número no tiene un local asignado." };
    const { data } = await db.from("resto_locales").select(cols).eq("id", m.local_id).maybeSingle();
    return data ? { local: data as Local } : { error: "No encontré tu local." };
  }
  const { data } = await db.from("resto_locales").select(cols).order("name");
  const lista = (data || []) as Local[];
  if (!lista.length) return { error: "No hay locales registrados." };
  const q = sinTildes(String(input?.local || "")).trim();
  if (q) {
    const hit = lista.filter((l) => l.id === input.local || sinTildes(l.name).includes(q));
    if (hit.length === 1) return { local: hit[0] };
    return { error: hit.length ? `Hay varios locales que coinciden: ${hit.map((l) => l.name).join(", ")}. Pide el nombre exacto.` : `No encontré un local llamado "${input.local}". Locales: ${lista.map((l) => l.name).join(", ")}.` };
  }
  if (lista.length === 1) return { local: lista[0] };
  return { error: `Hay varios locales: ${lista.map((l) => l.name).join(", ")}. Pregunta de cuál quiere saber.` };
}

const metodoDe = (x: any) => { const s = sinTildes(String(x || "")); return s.startsWith("tarj") ? "tarjeta" : s.startsWith("transf") ? "transferencia" : "efectivo"; };

function porMetodo(cuentas: any[]) {
  const r = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const c of cuentas) r[metodoDe(c.metodo) as keyof typeof r] += num(c.total);
  return r;
}

// ---------- Definiciones (lo que Claude ve) ----------
const LOCAL_PROP = { local: { type: "string", description: "Nombre del local. Solo hace falta si la persona administra varios; las administradoras siempre ven su propio local." } };

export const HERRAMIENTAS = [
  { name: "estado_caja", description: "Estado de la caja ahora: si está abierta, quién la abrió y cuándo, sencillo inicial, ventas del turno por forma de pago, gastos, retiros, efectivo esperado aproximado, quiénes han estado en caja. Si está cerrada, muestra el último cierre.", input_schema: { type: "object", properties: { ...LOCAL_PROP } } },
  { name: "ventas", description: "Ventas cobradas de un día o de un rango de días (hora de Chile): total cobrado, cantidad de cuentas, por forma de pago, propinas, descuentos, y por día si el rango es mayor a uno.", input_schema: { type: "object", properties: { ...LOCAL_PROP, desde: { type: "string", description: "Fecha AAAA-MM-DD. Por defecto, hoy." }, hasta: { type: "string", description: "Fecha AAAA-MM-DD (incluida). Por defecto, igual a desde." } } } },
  { name: "cierres", description: "Cierres de caja recientes con ventas, efectivo esperado, contado y diferencia (sobra o falta).", input_schema: { type: "object", properties: { ...LOCAL_PROP, dias: { type: "integer", description: "Cuántos días hacia atrás (1 a 14). Por defecto 3." } } } },
  { name: "alertas_control", description: "Alertas que dejó la revisión automática de aperturas y cierres de caja.", input_schema: { type: "object", properties: { ...LOCAL_PROP, dias: { type: "integer", description: "Días hacia atrás (1 a 14). Por defecto 3." }, solo_sin_ver: { type: "boolean", description: "Solo las que nadie ha marcado como vistas." } } } },
  { name: "pendientes", description: "Solicitudes que esperan respuesta de la administradora: anulaciones de productos y anulaciones de gastos de caja.", input_schema: { type: "object", properties: { ...LOCAL_PROP } } },
  { name: "actividad", description: "Registro de cambios del sistema: quién cambió qué y cuándo (carta, garzones, gastos y retiros de caja, aperturas y cierres, local).", input_schema: { type: "object", properties: { ...LOCAL_PROP, horas: { type: "integer", description: "Horas hacia atrás (1 a 72). Por defecto 6." }, quien: { type: "string", description: "Filtra por nombre de la persona." }, tabla: { type: "string", description: "Filtra por tipo: resto_gastos, resto_turnos, resto_menu, resto_garzones, resto_locales, resto_insumos." } } } },
  { name: "mesas", description: "Mesas con pedidos abiertos ahora, con el garzón y el estado de cada comanda.", input_schema: { type: "object", properties: { ...LOCAL_PROP } } },
  { name: "salud_sistema", description: "Estado del propio sistema: avisos del vigía de las últimas 24 horas, si el control de caja está activo, cuántos celulares reciben avisos push y cuándo fue la última revisión.", input_schema: { type: "object", properties: { ...LOCAL_PROP } } },
  { name: "locales", description: "Lista los locales (solo para el ingeniero).", input_schema: { type: "object", properties: {} } },
  { name: "proponer_mejora", description: "Guarda una propuesta de mejora o corrección del sistema en la lista de pendientes. No cambia nada por sí sola: el ingeniero decide si se hace.", input_schema: { type: "object", properties: { ...LOCAL_PROP, titulo: { type: "string", description: "Título corto." }, detalle: { type: "string", description: "Qué se propone y por qué." } }, required: ["titulo", "detalle"] } },
  { name: "ver_propuestas", description: "Lista las propuestas de mejora guardadas.", input_schema: { type: "object", properties: { ...LOCAL_PROP, estado: { type: "string", enum: ["pendiente", "aprobada", "rechazada"] } } } },
  { name: "resolver_propuesta", description: "Aprueba o rechaza una propuesta de mejora (solo el ingeniero). Solo cambia su estado en la lista.", input_schema: { type: "object", properties: { id: { type: "string", description: "Número de la propuesta." }, estado: { type: "string", enum: ["aprobada", "rechazada"] } }, required: ["id", "estado"] } },
] as const;

export function herramientasPara(m: Miembro) {
  return HERRAMIENTAS.filter((h) => m.rol === "ingeniero" || !["locales", "resolver_propuesta"].includes(h.name));
}

// ---------- Ejecución ----------
export async function ejecutar(nombre: string, input: any, m: Miembro): Promise<unknown> {
  try {
    if (nombre === "locales") {
      if (m.rol !== "ingeniero") return { error: "Solo el ingeniero puede ver todos los locales." };
      const { data } = await db.from("resto_locales").select("id,name,control_caja,tramo").order("name");
      return { locales: (data || []).map((l: any) => ({ nombre: l.name, control_caja: !!l.control_caja, tramo: l.tramo })) };
    }
    if (nombre === "resolver_propuesta") {
      if (m.rol !== "ingeniero") return { error: "Solo el ingeniero puede resolver propuestas." };
      const { data, error } = await db.from("resto_agente_propuestas").update({ estado: input.estado, resuelta_at: new Date().toISOString() }).eq("id", String(input.id)).select("id,titulo,estado").maybeSingle();
      if (error || !data) return { error: "No encontré esa propuesta." };
      return { ok: true, propuesta: data };
    }
    const r = await resolverLocal(m, input);
    // Las propuestas del ingeniero no dependen de un local en particular.
    const sinLocalOk = m.rol === "ingeniero" && (nombre === "ver_propuestas" || nombre === "proponer_mejora");
    if ("error" in r && !sinLocalOk) return r;
    const L: Local = "local" in r ? r.local : { id: "", name: "(general)", control_caja: false };
    switch (nombre) {
      case "estado_caja": return await estadoCaja(L);
      case "ventas": return await ventas(L, input);
      case "cierres": return await cierres(L, input);
      case "alertas_control": return await alertasControl(L, input);
      case "pendientes": return await pendientes(L);
      case "actividad": return await actividad(L, input);
      case "mesas": return await mesas(L);
      case "salud_sistema": return await saludSistema(L, m);
      case "proponer_mejora": {
        const titulo = String(input.titulo || "").trim().slice(0, 120), detalle = String(input.detalle || "").trim().slice(0, 1500);
        if (!titulo || !detalle) return { error: "Falta el título o el detalle." };
        const { data, error } = await db.from("resto_agente_propuestas").insert({ local_id: L.id || null, titulo, detalle, propuesta_por: m.nombre }).select("id").single();
        if (error) return { error: "No pude guardar la propuesta." };
        return { ok: true, id: data.id, nota: "Guardada como pendiente. El ingeniero decide si se hace." };
      }
      case "ver_propuestas": {
        let q = db.from("resto_agente_propuestas").select("id,titulo,detalle,estado,propuesta_por,created_at").order("created_at", { ascending: false }).limit(15);
        if (m.rol === "admin") q = q.eq("local_id", L.id);
        else if (L.id && input?.local) q = q.eq("local_id", L.id);
        if (input?.estado) q = q.eq("estado", input.estado);
        const { data } = await q;
        return { propuestas: (data || []).map((p: any) => ({ id: p.id, titulo: p.titulo, detalle: String(p.detalle).slice(0, 300), estado: p.estado, por: p.propuesta_por, cuando: fechaHoraCorta(new Date(p.created_at)) })) };
      }
    }
    return { error: "Herramienta desconocida: " + nombre };
  } catch (e) {
    return { error: "No pude consultar el dato: " + String((e as Error)?.message || e).slice(0, 200) };
  }
}

async function estadoCaja(L: Local) {
  const { data: t } = await db.from("resto_turnos").select("*").eq("local_id", L.id).is("cerrado_at", null).order("abierto_at", { ascending: false }).limit(1).maybeSingle();
  if (!t) {
    const { data: u } = await db.from("resto_turnos").select("*").eq("local_id", L.id).not("cerrado_at", "is", null).order("cerrado_at", { ascending: false }).limit(1).maybeSingle();
    return { local: L.name, caja_abierta: false, ultimo_cierre: u ? resumenTurno(u) : null };
  }
  const [cuentas, gastos, sesiones] = await Promise.all([
    todas<any>((a, b) => db.from("resto_cuentas").select("total,metodo,propina,descuento,cobrado_por,created_at,mesa").eq("turno_id", t.id).range(a, b)),
    todas<any>((a, b) => db.from("resto_gastos").select("tipo,monto,anulado,detalle,registrado_por,created_at").eq("turno_id", t.id).range(a, b)),
    db.from("resto_sesiones").select("usuario,rol,entrada,salida").eq("turno_id", t.id).order("entrada").limit(30).then((x) => x.data || []),
  ]);
  const metodo = porMetodo(cuentas);
  const vivos = gastos.filter((g) => !g.anulado);
  const gastosTot = suma(vivos.filter((g) => g.tipo !== "Retiro").map((g) => g.monto));
  const retirosTot = suma(vivos.filter((g) => g.tipo === "Retiro").map((g) => g.monto));
  const esperado = num(t.monto_inicial) + metodo.efectivo - gastosTot - retirosTot;
  const porPersona: Record<string, { cobros: number; total: number }> = {};
  for (const c of cuentas) { const k = c.cobrado_por || "(sin nombre)"; (porPersona[k] ||= { cobros: 0, total: 0 }); porPersona[k].cobros++; porPersona[k].total += num(c.total); }
  return {
    local: L.name, caja_abierta: true,
    abierta_por: t.abierto_por, desde: fechaHoraCorta(new Date(t.abierto_at)), lleva: duracion((Date.now() - new Date(t.abierto_at).getTime()) / 60000),
    sencillo_inicial: pesos(t.monto_inicial),
    cuentas_cobradas: cuentas.length,
    cobrado_total_incluye_propinas: pesos(suma(cuentas.map((c) => c.total))),
    por_forma_de_pago: { efectivo: pesos(metodo.efectivo), tarjeta: pesos(metodo.tarjeta), transferencia: pesos(metodo.transferencia) },
    propina_de_cuentas: pesos(suma(cuentas.map((c) => c.propina))),
    descuentos: pesos(suma(cuentas.map((c) => c.descuento))),
    gastos_pagados_de_caja: pesos(gastosTot), retiros_de_efectivo: pesos(retirosTot),
    efectivo_esperado_aproximado: pesos(esperado),
    nota_esperado: "Aproximado: no descuenta propinas pagadas a garzones. El valor oficial está en la pestaña Caja.",
    cobros_por_persona: Object.fromEntries(Object.entries(porPersona).map(([k, v]) => [k, `${v.cobros} cobros · ${pesos(v.total)}`])),
    en_caja: sesiones.map((s: any) => `${s.usuario}${s.rol ? " (" + s.rol + ")" : ""} desde ${horaChile(new Date(s.entrada))}${s.salida ? " hasta " + horaChile(new Date(s.salida)) : ""}`),
    gastos_recientes: vivos.filter((g) => g.tipo !== "Retiro").slice(-5).map((g) => `${pesos(g.monto)} · ${g.detalle} · ${g.registrado_por || ""}`),
  };
}

function resumenTurno(t: any) {
  return {
    abrio: t.abierto_por, abierto: fechaHoraCorta(new Date(t.abierto_at)), cerro: t.cerrado_por, cerrado: t.cerrado_at ? fechaHoraCorta(new Date(t.cerrado_at)) : null,
    sencillo_inicial: pesos(t.monto_inicial), ventas: pesos(t.ventas_total), cuentas: t.cuentas ?? null,
    tarjetas: pesos(t.ventas_tarjeta), transferencias: pesos(t.ventas_transf),
    efectivo_esperado: t.esperado_efectivo != null ? pesos(t.esperado_efectivo) : null, efectivo_contado: t.contado_efectivo != null ? pesos(t.contado_efectivo) : null,
    diferencia: t.diferencia == null ? null : t.diferencia === 0 ? "cuadra" : t.diferencia > 0 ? `sobran ${pesos(t.diferencia)}` : `faltan ${pesos(-t.diferencia)}`,
    nota: t.nota || null,
  };
}

function fechaValida(s: unknown, defecto: string): string {
  const v = String(s || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(new Date(v + "T00:00:00Z").getTime()) ? v : defecto;
}

async function ventas(L: Local, input: any) {
  const hoy = fechaChile();
  const desdeF = fechaValida(input?.desde, hoy);
  let hastaF = fechaValida(input?.hasta, desdeF);
  if (hastaF < desdeF) hastaF = desdeF;
  if (sumarDias(desdeF, MAX_DIAS) < hastaF) return { error: `El rango máximo es de ${MAX_DIAS} días.` };
  const desde = rangoDiaChile(desdeF).desde, hasta = rangoDiaChile(hastaF).hasta;
  const cuentas = await todas<any>((a, b) => db.from("resto_cuentas").select("total,metodo,propina,descuento,created_at").eq("local_id", L.id).gte("created_at", desde.toISOString()).lt("created_at", hasta.toISOString()).order("created_at").range(a, b));
  const metodo = porMetodo(cuentas);
  const total = suma(cuentas.map((c) => c.total));
  const out: Record<string, unknown> = {
    local: L.name, desde: desdeF, hasta: hastaF, cuentas: cuentas.length,
    cobrado_total_incluye_propinas: pesos(total),
    ticket_promedio: pesos(cuentas.length ? total / cuentas.length : 0),
    por_forma_de_pago: { efectivo: pesos(metodo.efectivo), tarjeta: pesos(metodo.tarjeta), transferencia: pesos(metodo.transferencia) },
    propina_de_cuentas: pesos(suma(cuentas.map((c) => c.propina))), descuentos: pesos(suma(cuentas.map((c) => c.descuento))),
  };
  if (desdeF !== hastaF) {
    const dias: Record<string, { cuentas: number; total: number }> = {};
    for (const c of cuentas) { const k = fechaChile(new Date(c.created_at)); (dias[k] ||= { cuentas: 0, total: 0 }); dias[k].cuentas++; dias[k].total += num(c.total); }
    out.por_dia = Object.fromEntries(Object.entries(dias).sort().map(([k, v]) => [k, `${v.cuentas} cuentas · ${pesos(v.total)}`]));
  }
  return out;
}

async function cierres(L: Local, input: any) {
  const dias = Math.min(14, Math.max(1, num(input?.dias) || 3));
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const { data } = await db.from("resto_turnos").select("*").eq("local_id", L.id).not("cerrado_at", "is", null).gte("cerrado_at", desde).order("cerrado_at", { ascending: false }).limit(20);
  return { local: L.name, dias, cierres: (data || []).map(resumenTurno) };
}

async function alertasControl(L: Local, input: any) {
  const dias = Math.min(14, Math.max(1, num(input?.dias) || 3));
  let q = db.from("resto_control_alertas").select("fase,regla,gravedad,titulo,detalle,revisar,created_at,visto_por,visto_at").eq("local_id", L.id)
    .gte("created_at", new Date(Date.now() - dias * 86400000).toISOString()).order("created_at", { ascending: false }).limit(25);
  if (input?.solo_sin_ver) q = q.is("visto_at", null);
  const { data } = await q;
  return { local: L.name, alertas: (data || []).map((a: any) => ({ cuando: fechaHoraCorta(new Date(a.created_at)), fase: a.fase, gravedad: a.gravedad, titulo: a.titulo, detalle: String(a.detalle).slice(0, 300), que_revisar: String(a.revisar).slice(0, 200), visto: a.visto_at ? `sí, ${a.visto_por || ""}` : "no" })) };
}

async function pendientes(L: Local) {
  const [an, ga] = await Promise.all([
    db.from("resto_anulaciones").select("item_n,cantidad,mesa,pedida_por,motivo,created_at").eq("local_id", L.id).eq("estado", "pendiente").order("created_at").limit(20).then((x) => x.data || []),
    db.from("resto_gastos").select("tipo,numero,monto,anul_pedida_por,anul_pedida_motivo,created_at").eq("local_id", L.id).eq("anulado", false).not("anul_pedida_motivo", "is", null).order("created_at").limit(20).then((x) => x.data || []),
  ]);
  return {
    local: L.name,
    anulaciones_de_productos: an.map((a: any) => `${a.pedida_por || "?"} pide anular ${a.cantidad}× ${a.item_n} · ${mesaTxt(a.mesa)} · hace ${duracion((Date.now() - new Date(a.created_at).getTime()) / 60000)}${a.motivo ? " · " + a.motivo : ""}`),
    anulaciones_de_gastos: ga.map((g: any) => `${g.anul_pedida_por || "?"} pide anular ${g.tipo}${g.numero ? " N° " + g.numero : ""} por ${pesos(g.monto)} · ${g.anul_pedida_motivo}`),
  };
}

async function actividad(L: Local, input: any) {
  const horas = Math.min(72, Math.max(1, num(input?.horas) || 6));
  let q = db.from("resto_bitacora").select("at,quien,rol,tabla,accion,fila,detalle").eq("local_id", L.id)
    .gte("at", new Date(Date.now() - horas * 3600000).toISOString()).order("at", { ascending: false }).limit(40);
  if (input?.quien) q = q.ilike("quien", `%${String(input.quien).replace(/[%_]/g, "")}%`);
  if (input?.tabla) q = q.eq("tabla", String(input.tabla));
  const { data } = await q;
  return { local: L.name, horas, registros: (data || []).map((b: any) => ({ cuando: fechaHoraCorta(new Date(b.at)), quien: b.quien, rol: b.rol, que: `${b.accion} en ${b.tabla}`, fila: b.fila, detalle: JSON.stringify(b.detalle || {}).slice(0, 220) })) };
}

async function mesas(L: Local) {
  const { data } = await db.from("resto_comandas").select("mesa,garzon,estado,created_at,items").eq("local_id", L.id).eq("cerrada", false).order("created_at").limit(300);
  const por: Record<number, { garzon: string; comandas: number; estados: Set<string>; desde: string }> = {};
  for (const c of data || []) {
    const e = (por[c.mesa] ||= { garzon: c.garzon || "", comandas: 0, estados: new Set(), desde: c.created_at });
    e.comandas++; e.estados.add(c.estado);
  }
  return {
    local: L.name, mesas_con_pedido: Object.entries(por).map(([m, e]) => ({ mesa: mesaTxt(Number(m)), garzon: e.garzon || "(sin garzón)", comandas: e.comandas, estados: [...e.estados], desde: horaChile(new Date(e.desde)) })),
  };
}

async function saludSistema(L: Local, m: Miembro) {
  const hace24 = new Date(Date.now() - 86400000).toISOString();
  const [avisos, push, rev, mig] = await Promise.all([
    db.from("resto_agente_avisos").select("gravedad,titulo,detalle,created_at").eq("local_id", L.id).gte("created_at", hace24).order("created_at", { ascending: false }).limit(15).then((x) => x.data || []),
    db.from("resto_push_subs").select("id", { count: "exact", head: true }).eq("local_id", L.id).then((x) => x.count ?? 0),
    db.from("resto_control_revisiones").select("fase,revisado_at,n_alertas").eq("local_id", L.id).order("revisado_at", { ascending: false }).limit(1).then((x) => x.data?.[0] || null),
    m.rol === "ingeniero" ? db.from("resto_migraciones").select("nombre,aplicada_at").order("nombre", { ascending: false }).limit(3).then((x) => x.data || []) : Promise.resolve([]),
  ]);
  const out: Record<string, unknown> = {
    local: L.name, control_de_caja_activo: !!L.control_caja, tramo: L.tramo ?? null, celulares_con_avisos_push: push,
    ultima_revision_control: rev ? `${rev.fase} · ${fechaHoraCorta(new Date(rev.revisado_at))} · ${rev.n_alertas} alertas` : "ninguna todavía",
    avisos_del_vigia_24h: avisos.map((a: any) => `${fechaHoraCorta(new Date(a.created_at))} · ${a.gravedad} · ${a.titulo}`),
  };
  if (m.rol === "ingeniero") out.ultimas_migraciones = (mig as any[]).map((x) => x.nombre);
  return out;
}

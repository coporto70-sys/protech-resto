// Protech Resto · control de caja
// Función Edge de Supabase. IMPORTANTE: publicarla con la verificación de JWT DESACTIVADA
// (la llama la base de datos con la clave interna 'secreto' de resto_push_config, igual que resto-push).
// Secretos: ANTHROPIC_API_KEY es OPCIONAL (sin ella igual detecta y avisa; solo no redacta el resumen en lenguaje simple).
//
// Acciones (todas exigen el encabezado x-push-secret):
//   { accion: "revisar", turno_id }                       → revisa ese turno cerrado y avisa por push a los administradores
//   { accion: "revisar_apertura", turno_id }              → revisa el conteo de sencillo de un turno recién abierto y avisa por push
//   { accion: "revisar_ultimos", local_id, dias?: 7 }     → revisa los cierres de los últimos días SIN mandar push (para probar)
//
// Solo LEE los datos de caja y GUARDA alertas. Nunca corrige, anula ni mueve dinero.
import { createClient } from "npm:@supabase/supabase-js@2";
import { ordenar, resumenPush, revisarApertura, revisarTurno, totalDen, type Alerta, type Gasto, type Turno } from "./reglas.ts";

const MODELO = "claude-haiku-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const INSTRUCCIONES = `Eres el asistente de caja de la cafetería Super Pastel, mano derecha de la administradora. Tu trabajo es explicar, en pocas líneas, las alertas que dejó la revisión automática de una apertura o un cierre de caja.

Reglas:
- Solo lees y avisas. Nunca autorizas, corriges, anulas ni mueves dinero.
- Usa SOLO las cifras que vienen en las alertas. No inventes ni recalcules ningún monto.
- Español simple y corto, para una persona sin conocimientos técnicos.
- Nunca acuses a nadie. Di "puede haber un error al ingresar", no "se equivocó fulano".
- Ordena de lo más grave a lo menos grave y termina con qué conviene revisar primero.
- Máximo 5 líneas.`;

async function secreto(): Promise<string | null> {
  const { data } = await db.from("resto_push_config").select("valor").eq("clave", "secreto").maybeSingle();
  return data?.valor ?? null;
}

// Resumen en lenguaje simple. Si falla, no hay clave o menciona un monto que no vino en las alertas, se devuelve null
// (las alertas igual quedan guardadas y el push sale con el texto fijo).
async function redactar(alertas: Alerta[]): Promise<string | null> {
  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!clave || !alertas.length) return null;
  const entrada = JSON.stringify(alertas.map(({ gravedad, titulo, detalle, revisar }) => ({ gravedad, titulo, detalle, revisar })));
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO, max_tokens: 400, system: INSTRUCCIONES, messages: [{ role: "user", content: "Alertas de la revisión:\n" + entrada }] }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    // Control: todo monto que aparezca en el texto debe existir en las alertas
    const montos = txt.match(/\$[\d.]+/g) || [];
    if (!txt || montos.some((m) => !entrada.includes(m))) return null;
    return txt.slice(0, 900);
  } catch {
    return null;
  }
}

async function revisarUno(turnoId: string, avisar: boolean) {
  const { data: t } = await db.from("resto_turnos").select("*").eq("id", turnoId).maybeSingle();
  if (!t) return { error: "turno no encontrado" };
  if (!t.cerrado_at) return { error: "el turno sigue abierto" };

  // Un turno se revisa una sola vez (el disparador puede repetirse)
  const { data: ya } = await db.from("resto_control_revisiones").select("turno_id").eq("turno_id", turnoId).eq("fase", "cierre").maybeSingle();
  if (ya && avisar) return { ok: true, repetido: true };

  const { data: local } = await db.from("resto_locales").select("fondo_caja").eq("id", t.local_id).maybeSingle();
  const { data: gastos } = await db.from("resto_gastos").select("*").eq("turno_id", turnoId);
  const desde = new Date(new Date(t.cerrado_at).getTime() - 24 * 3_600_000).toISOString();
  const { data: retiros } = await db.from("resto_gastos").select("*").eq("local_id", t.local_id).eq("tipo", "Retiro").gte("created_at", desde).lte("created_at", t.cerrado_at);

  const alertas = revisarTurno(t as Turno, (gastos || []) as Gasto[], { fondo: local?.fondo_caja ?? 0, retirosRecientes: (retiros || []) as Gasto[] });
  if (alertas.length) {
    await db.from("resto_control_alertas").upsert(
      alertas.map((a) => ({ local_id: t.local_id, turno_id: turnoId, fase: "cierre", regla: a.regla, gravedad: a.gravedad, titulo: a.titulo, detalle: a.detalle, revisar: a.revisar })),
      { onConflict: "turno_id,regla,detalle", ignoreDuplicates: true },
    );
  }
  const importantes = ordenar(alertas).filter((a) => a.gravedad !== "baja");
  const aviso = avisar ? await redactar(importantes) : null;
  await db.from("resto_control_revisiones").upsert({ turno_id: turnoId, fase: "cierre", local_id: t.local_id, revisado_at: new Date().toISOString(), n_alertas: alertas.length, aviso }, { onConflict: "turno_id,fase" });

  if (avisar && importantes.length) {
    const p = resumenPush(importantes);
    await db.rpc("resto_push_enviar", { p_local: t.local_id, p_titulo: p.titulo, p_cuerpo: p.cuerpo, p_tag: "ctrl-" + turnoId });
  }
  return { ok: true, alertas: alertas.length, importantes: importantes.length };
}

async function revisarAperturaUno(turnoId: string) {
  const { data: t } = await db.from("resto_turnos").select("*").eq("id", turnoId).maybeSingle();
  if (!t) return { error: "turno no encontrado" };
  const { data: ya } = await db.from("resto_control_revisiones").select("turno_id").eq("turno_id", turnoId).eq("fase", "apertura").maybeSingle();
  if (ya) return { ok: true, repetido: true };

  const { data: local } = await db.from("resto_locales").select("fondo_caja").eq("id", t.local_id).maybeSingle();
  // Lo que dejó el turno anterior al cerrar
  const { data: ant } = await db.from("resto_turnos").select("desglose_deja").eq("local_id", t.local_id).neq("id", turnoId).not("cerrado_at", "is", null).lte("cerrado_at", t.abierto_at).order("cerrado_at", { ascending: false }).limit(1).maybeSingle();
  const anteriorDeja = ant?.desglose_deja ? totalDen(ant.desglose_deja) : null;

  const alertas = revisarApertura(t as Turno, { fondo: local?.fondo_caja ?? 0, anteriorDeja });
  if (alertas.length) {
    await db.from("resto_control_alertas").upsert(
      alertas.map((a) => ({ local_id: t.local_id, turno_id: turnoId, fase: "apertura", regla: a.regla, gravedad: a.gravedad, titulo: a.titulo, detalle: a.detalle, revisar: a.revisar })),
      { onConflict: "turno_id,regla,detalle", ignoreDuplicates: true },
    );
  }
  const importantes = ordenar(alertas).filter((a) => a.gravedad !== "baja");
  const aviso = await redactar(importantes);
  await db.from("resto_control_revisiones").upsert({ turno_id: turnoId, fase: "apertura", local_id: t.local_id, revisado_at: new Date().toISOString(), n_alertas: alertas.length, aviso }, { onConflict: "turno_id,fase" });
  if (importantes.length) {
    const p = resumenPush(importantes);
    await db.rpc("resto_push_enviar", { p_local: t.local_id, p_titulo: p.titulo.replace("Revisión de caja", "Apertura de caja"), p_cuerpo: p.cuerpo, p_tag: "ctrl-ap-" + turnoId });
  }
  return { ok: true, alertas: alertas.length, importantes: importantes.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  const sec = await secreto();
  if (!sec || req.headers.get("x-push-secret") !== sec) return json({ error: "no autorizado" }, 401);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: "solicitud inválida" }, 400); }

  if (b.accion === "revisar" && b.turno_id) return json(await revisarUno(String(b.turno_id), true));
  if (b.accion === "revisar_apertura" && b.turno_id) return json(await revisarAperturaUno(String(b.turno_id)));

  if (b.accion === "revisar_ultimos" && b.local_id) {
    const dias = Math.min(Math.max(Number(b.dias) || 7, 1), 60);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    const { data: turnos } = await db.from("resto_turnos").select("id").eq("local_id", b.local_id).not("cerrado_at", "is", null).gte("cerrado_at", desde).order("cerrado_at");
    const res = [];
    for (const t of turnos || []) res.push({ turno_id: t.id, ...(await revisarUno(t.id, false)) });
    return json({ ok: true, revisados: res.length, res });
  }
  return json({ error: "acción desconocida" }, 400);
});

// Protech Resto · agente de WhatsApp con Claude
// Función Edge de Supabase. Publicarla SIN verificación de JWT (la llama Meta).
// Secretos: ANTHROPIC_API_KEY. Datos por local: tabla resto_wa_config (ver migración 024).
// Flujo: Meta -> esta función -> Claude (con la carta y la info del local) -> respuesta por WhatsApp.
// Si Claude decide que hace falta una persona (herramienta pasar_a_persona), la conversación queda en modo 'humano',
// el agente deja de responder y se avisa a la administradora por notificación push (y por WhatsApp si hay aviso_a).
import { avisarPush, db, enviarWA, firmaOk, igualSeguro } from "./wa.ts";
import { atenderEquipo, buscarMiembro, eventoTurno, vigiar } from "./operaciones.ts";

// Un mismo número de WhatsApp atiende a dos públicos:
//   · Equipo (ingeniero y administradoras, tabla resto_wa_equipo): lo atiende el agente de operaciones (operaciones.ts).
//   · Cualquier otra persona (clientes): lo atiende el agente de clientes de este archivo.
// Además, la base y el cron llaman a esta función con la clave interna para las acciones "vigia" y "evento_turno".
const MODELO = "claude-haiku-5-5";
const LIMITE_POR_HORA = 20; // respuestas del agente por cliente y hora (evita gastos si alguien abusa)

async function contexto(cfg: any) {
  const { data: loc } = await db.from("resto_locales").select("*").eq("id", cfg.local_id).maybeSingle();
  const { data: menu } = await db.from("resto_menu").select("nombre,categoria,precio,activo,stock").eq("local_id", cfg.local_id).order("categoria");
  const lineas: string[] = [];
  let cat = "";
  for (const m of menu || []) {
    if (m.activo === false) continue;
    const agotado = m.stock != null && m.stock <= 0;
    if (m.categoria !== cat) { cat = m.categoria; lineas.push(`\n${cat || "Otros"}:`); }
    lineas.push(`- ${m.nombre}: $${Number(m.precio).toLocaleString("es-CL")}${agotado ? " (agotado hoy)" : ""}`);
  }
  const nombre = loc?.nombre || "el local";
  const sistema = `Eres el asistente de WhatsApp de "${nombre}". Atiendes a clientes del local por WhatsApp, en español de Chile, con un tono cálido, breve y claro (mensajes cortos, sin formato complicado).${cfg.tono ? "\nTono pedido por el local: " + cfg.tono : ""}

Reglas:
- Responde solo con la información de abajo (carta, precios, datos del local). Si no tienes un dato, dilo y ofrece pasar con una persona. NUNCA inventes precios, horarios, ingredientes, promociones ni disponibilidad.
- No tomes pedidos ni reservas por tu cuenta, ni prometas que algo quedó anotado. Si el cliente quiere reservar, pedir, hacer un reclamo, pagar, o pide hablar con una persona, usa la herramienta pasar_a_persona y dile que una persona le responderá pronto.
- Si el cliente está molesto o reclama, usa pasar_a_persona.
- No pidas ni aceptes datos de tarjetas, claves ni documentos de identidad.
- Si preguntan algo ajeno al local, di amablemente que solo puedes ayudar con el local.

INFORMACIÓN DEL LOCAL:
${cfg.info || "(sin información adicional cargada)"}

CARTA:${lineas.join("\n") || "\n(sin productos cargados)"}`;
  return sistema;
}

async function responder(cfg: any, tel: string, nombre: string, texto: string, waId: string) {
  // Evita duplicados (Meta puede reenviar el mismo mensaje)
  const ins = await db.from("resto_wa_msgs").insert({ local_id: cfg.local_id, telefono: tel, autor: "cliente", texto: texto.slice(0, 2000), wa_id: waId });
  if (ins.error) return;
  const { data: chat } = await db.from("resto_wa_chats").select("modo").eq("local_id", cfg.local_id).eq("telefono", tel).maybeSingle();
  if (!chat) await db.from("resto_wa_chats").insert({ local_id: cfg.local_id, telefono: tel, nombre });
  else await db.from("resto_wa_chats").update({ actualizado: new Date().toISOString(), nombre }).eq("local_id", cfg.local_id).eq("telefono", tel);
  if (chat?.modo === "humano") {
    await avisarPush(cfg.local_id, "WhatsApp: " + (nombre || tel), texto.slice(0, 120));
    return; // lo atiende una persona
  }

  const desde = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("resto_wa_msgs").select("id", { count: "exact", head: true })
    .eq("local_id", cfg.local_id).eq("telefono", tel).eq("autor", "bot").gte("created_at", desde);
  if ((count ?? 0) >= LIMITE_POR_HORA) return;

  const { data: hist } = await db.from("resto_wa_msgs").select("autor,texto").eq("local_id", cfg.local_id).eq("telefono", tel)
    .order("created_at", { ascending: false }).limit(12);
  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of (hist || []).reverse()) {
    const role = m.autor === "cliente" ? "user" : "assistant";
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + m.texto;
    else msgs.push({ role, content: m.texto });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return;

  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  let respuesta = "", pasar = false, motivo = "";
  if (!clave) { pasar = true; motivo = "Agente sin clave de IA"; }
  else {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELO, max_tokens: 500, system: await contexto(cfg), messages: msgs,
        tools: [{
          name: "pasar_a_persona",
          description: "Pasa la conversación a una persona del local (reservas, pedidos, reclamos, dudas que no puedes resolver o petición del cliente).",
          input_schema: { type: "object", properties: { motivo: { type: "string", description: "Resumen corto de lo que necesita el cliente" } }, required: ["motivo"] },
        }],
      }),
    });
    if (!r.ok) { pasar = true; motivo = "Falla del agente (" + r.status + ")"; }
    else {
      const j = await r.json();
      for (const c of j.content || []) {
        if (c.type === "text") respuesta += c.text;
        if (c.type === "tool_use" && c.name === "pasar_a_persona") { pasar = true; motivo = String(c.input?.motivo || "Pide una persona").slice(0, 200); }
      }
      respuesta = respuesta.trim();
    }
  }
  if (pasar && !respuesta) respuesta = "Gracias por escribirnos 🙌 Ya avisé a una persona del local para que te responda pronto.";
  if (!respuesta) return;

  if (await enviarWA(cfg, tel, respuesta)) {
    await db.from("resto_wa_msgs").insert({ local_id: cfg.local_id, telefono: tel, autor: "bot", texto: respuesta });
  }
  if (pasar) {
    await db.from("resto_wa_chats").update({ modo: "humano", motivo, actualizado: new Date().toISOString() }).eq("local_id", cfg.local_id).eq("telefono", tel);
    await avisarPush(cfg.local_id, "WhatsApp: " + (nombre || tel) + " necesita una persona", motivo);
    if (cfg.aviso_a) await enviarWA(cfg, cfg.aviso_a, `Un cliente (${nombre || tel}, +${tel}) necesita una persona: ${motivo}\nResponde en WhatsApp: https://wa.me/${tel}`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Verificación inicial del webhook (Meta llama con GET)
  if (req.method === "GET") {
    const tok = url.searchParams.get("hub.verify_token") || "";
    const { data } = tok ? await db.from("resto_wa_config").select("local_id").eq("verify_token", tok).limit(1) : { data: [] };
    if (url.searchParams.get("hub.mode") === "subscribe" && data && data.length) return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    return new Response("no autorizado", { status: 403 });
  }
  if (req.method !== "POST") return new Response("método no permitido", { status: 405 });

  const cuerpo = await req.text();
  let b: any;
  try { b = JSON.parse(cuerpo); } catch { return new Response("ok"); }

  // Acciones internas (las llama la base de datos o el cron, no Meta): exigen la clave interna del sistema
  if (typeof b?.accion === "string") {
    const { data: s } = await db.from("resto_push_config").select("valor").eq("clave", "secreto").maybeSingle();
    const dado = req.headers.get("x-push-secret") || "";
    if (!s || !dado || !igualSeguro(dado, s.valor)) return json({ error: "no autorizado" }, 401);
    try {
      if (b.accion === "vigia") return json(await vigiar());
      if (b.accion === "evento_turno" && b.turno_id && b.fase) return json(await eventoTurno(String(b.fase), String(b.turno_id)));
    } catch (e) {
      return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
    }
    return json({ error: "acción desconocida" }, 400);
  }

  const tareas: Promise<void>[] = [];
  for (const ent of b.entry || []) for (const ch of ent.changes || []) {
    const v = ch.value || {};
    const pid = v.metadata?.phone_number_id;
    if (!pid || !(v.messages || []).length) continue;
    const { data: cfg } = await db.from("resto_wa_config").select("*").eq("phone_number_id", pid).eq("activo", true).maybeSingle();
    if (!cfg) continue;
    if (cfg.app_secret && !(await firmaOk(cfg.app_secret, cuerpo, req.headers.get("x-hub-signature-256")))) continue;
    for (const m of v.messages) {
      const tel = String(m.from || "");
      const nombre = (v.contacts || []).find((c: any) => c.wa_id === tel)?.profile?.name || "";
      const texto = m.type === "text" ? m.text?.body : (m.type === "button" ? m.button?.text : "");
      if (!tel) continue;
      // ¿Es del equipo? Entonces lo atiende el agente de operaciones, que muestra datos del local:
      // solo se acepta si el mensaje viene firmado por Meta (app_secret cargado), para que nadie pueda suplantar un número.
      const miembro = await buscarMiembro(tel);
      if (miembro) {
        if (!cfg.app_secret) continue;
        if (!texto) { tareas.push(enviarWA(cfg, tel, "Por ahora solo leo mensajes de texto 🙂").then(() => {})); continue; }
        tareas.push(atenderEquipo(cfg, miembro, String(texto), String(m.id)).catch(() => {}));
        continue;
      }
      if (!texto) { // audio, imagen, etc.: se pide que escriba
        tareas.push(enviarWA(cfg, tel, "Por ahora solo puedo leer mensajes de texto 🙂 ¿Me escribes tu consulta?").then(() => {}));
        continue;
      }
      tareas.push(responder(cfg, tel, nombre, String(texto), String(m.id)).catch(() => {}));
    }
  }
  // Meta exige un 200 rápido (si tarda, reintenta). Las respuestas siguen en segundo plano; si el entorno no lo permite, se espera.
  const todo = Promise.all(tareas);
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(todo); else await todo;
  return new Response("ok"); // si algo falla, igual se responde 200 para que Meta no reintente en bucle
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

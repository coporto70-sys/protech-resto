// Protech Resto · agente de WhatsApp con Claude
// Función Edge de Supabase. Publicarla SIN verificación de JWT (la llama Meta).
// Secretos: ANTHROPIC_API_KEY. Datos por local: tabla resto_wa_config (ver migración 024).
// Flujo: Meta -> esta función -> Claude (con la carta y la info del local) -> respuesta por WhatsApp.
// Si Claude decide que hace falta una persona (herramienta pasar_a_persona), la conversación queda en modo 'humano',
// el agente deja de responder y se avisa a la administradora por notificación push (y por WhatsApp si hay aviso_a).
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELO = "claude-haiku-5-5";
const LIMITE_POR_HORA = 20; // respuestas del agente por cliente y hora (evita gastos si alguien abusa)
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GRAPH = "https://graph.facebook.com/v21.0";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function firmaOk(secret: string, cuerpo: string, cab: string | null): Promise<boolean> {
  if (!cab || !cab.startsWith("sha256=")) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(cuerpo)));
  const a = cab.slice(7);
  if (a.length !== esperada.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ esperada.charCodeAt(i);
  return d === 0;
}

async function enviarWA(cfg: any, a: string, texto: string) {
  const r = await fetch(`${GRAPH}/${cfg.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: a, type: "text", text: { body: texto.slice(0, 3800) } }),
  });
  return r.ok;
}

async function avisarPush(localId: string, titulo: string, cuerpo: string) {
  try {
    const { data: u } = await db.from("resto_push_config").select("valor").eq("clave", "url").maybeSingle();
    const { data: s } = await db.from("resto_push_config").select("valor").eq("clave", "secreto").maybeSingle();
    if (!u || !s) return;
    await fetch(u.valor, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-push-secret": s.valor },
      body: JSON.stringify({ accion: "enviar", local_id: localId, titulo, cuerpo, tag: "wa-humano" }),
    });
  } catch { /* el aviso es secundario */ }
}

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
  const nombre = loc?.name || "el local";
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
      if (!texto) { // audio, imagen, etc.: se pide que escriba
        tareas.push(enviarWA(cfg, tel, "Por ahora solo puedo leer mensajes de texto 🙂 ¿Me escribes tu consulta?").then(() => {}));
        continue;
      }
      tareas.push(responder(cfg, tel, nombre, String(texto), String(m.id)).catch(() => {}));
    }
  }
  await Promise.all(tareas);
  return new Response("ok"); // Meta exige 200 rápido; si falla algo, igual se responde 200 para que no reintente en bucle
});

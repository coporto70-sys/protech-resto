// Piezas compartidas por el agente de clientes y el agente de operaciones: base de datos, firma de Meta y envío de mensajes.
import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export const GRAPH = "https://graph.facebook.com/v21.0";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Comprueba que el mensaje viene de Meta (firma HMAC-SHA256 con el "secreto de la app"). */
export async function firmaOk(secret: string, cuerpo: string, cab: string | null): Promise<boolean> {
  if (!cab || !cab.startsWith("sha256=")) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const esperada = hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(cuerpo)));
  const a = cab.slice(7);
  if (a.length !== esperada.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ esperada.charCodeAt(i);
  return d === 0;
}

/** Compara dos textos en tiempo constante (para claves internas). */
export function igualSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function enviarWA(cfg: any, a: string, texto: string): Promise<boolean> {
  const r = await fetch(`${GRAPH}/${cfg.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: a, type: "text", text: { body: texto.slice(0, 3800) } }),
  });
  return r.ok;
}

/** Mensaje con plantilla aprobada por Meta (la única forma de escribir primero, pasadas 24 h del último mensaje de la persona). */
export async function enviarPlantilla(cfg: any, a: string, plantilla: string, texto: string): Promise<boolean> {
  // Las plantillas no admiten saltos de línea ni tabulaciones dentro de una variable.
  const limpio = texto.replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").slice(0, 900);
  const r = await fetch(`${GRAPH}/${cfg.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: a, type: "template",
      template: { name: plantilla, language: { code: "es" }, components: [{ type: "body", parameters: [{ type: "text", text: limpio }] }] },
    }),
  });
  return r.ok;
}

/** Notificación push a los celulares de los administradores (usa la función resto-push). */
export async function avisarPush(localId: string, titulo: string, cuerpo: string, tag = "wa-humano") {
  try {
    const { data: u } = await db.from("resto_push_config").select("valor").eq("clave", "url").maybeSingle();
    const { data: s } = await db.from("resto_push_config").select("valor").eq("clave", "secreto").maybeSingle();
    if (!u || !s) return;
    await fetch(u.valor, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-push-secret": s.valor },
      body: JSON.stringify({ accion: "enviar", local_id: localId, titulo, cuerpo, tag }),
    });
  } catch { /* el aviso es secundario */ }
}

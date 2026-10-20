// Protech Resto · avisos push a la administradora
// Función Edge de Supabase. IMPORTANTE: publicarla con la verificación de JWT DESACTIVADA
// (la llama la base de datos con una clave interna, y el navegador solo para pedir la clave pública).
// No necesita secretos propios: las claves VAPID se crean solas la primera vez y se guardan en resto_push_config.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function cfg(clave: string): Promise<string | null> {
  const { data } = await db.from("resto_push_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}

// Par de claves VAPID: se crea una sola vez (si dos llamadas coinciden, gana la primera y ambas usan la misma)
async function claves(): Promise<{ pub: string; priv: string }> {
  let v = await cfg("vapid");
  if (!v) {
    const k = webpush.generateVAPIDKeys();
    await db.from("resto_push_config").upsert({ clave: "vapid", valor: JSON.stringify({ pub: k.publicKey, priv: k.privateKey }) }, { onConflict: "clave", ignoreDuplicates: true });
    v = await cfg("vapid");
  }
  return JSON.parse(v!);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: "solicitud inválida" }, 400); }

  // El navegador pide la clave pública para suscribirse (es pública por diseño)
  if (b.accion === "clave") {
    const k = await claves();
    return json({ clave: k.pub });
  }

  // La base de datos pide enviar un aviso: se exige la clave interna
  if (b.accion === "enviar") {
    const secreto = await cfg("secreto");
    if (!secreto || req.headers.get("x-push-secret") !== secreto) return json({ error: "no autorizado" }, 401);
    if (!b.local_id || !b.titulo) return json({ error: "faltan datos" }, 400);
    const k = await claves();
    webpush.setVapidDetails("mailto:soporte@protechdigital.cl", k.pub, k.priv);
    const { data: subs } = await db.from("resto_push_subs").select("id,endpoint,p256dh,auth").eq("local_id", b.local_id);
    const payload = JSON.stringify({ titulo: String(b.titulo).slice(0, 80), cuerpo: String(b.cuerpo || "").slice(0, 200), tag: String(b.tag || "resto"), url: "./" });
    let enviados = 0;
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "high" });
        enviados++;
      } catch (e: any) {
        // El equipo ya no existe (desinstaló la app o quitó el permiso): se borra
        if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("resto_push_subs").delete().eq("id", s.id);
      }
    }));
    return json({ ok: true, enviados });
  }
  return json({ error: "acción desconocida" }, 400);
});

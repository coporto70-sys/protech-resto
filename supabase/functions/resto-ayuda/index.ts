// Protech Resto · asistente de ayuda con Claude
// Función Edge de Supabase. Requiere el secreto ANTHROPIC_API_KEY (Edge Functions → Secrets).
// Seguridad: exige sesión iniciada (verify_jwt), responde solo a locales con membresía y limita el uso por hora.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELO = "claude-haiku-5-5";
const LIMITE_POR_HORA = 40;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const GUIA = `- Para entrar usa el correo y la clave de tu local (las cuentas las crea Protech). Si es tu primera vez o olvidaste la clave, toca "Primera vez o olvidé mi clave", escribe el correo del local y te llega un enlace para crear una clave nueva (revisa también spam). Después de entrar, cada persona elige su nombre y pone su PIN.
- La sesión se mantiene abierta por 16 horas desde el último uso. Si te pide entrar de nuevo: recarga la página una vez para tomar la última versión y revisa que tengas internet estable. Si sigue pasando, escríbenos y lo revisamos: toca "Hablar con una persona".
- Si el local tiene PIN de administradora, cada persona elige quién es y entra con su PIN. La administradora ve todo; los garzones solo Mesas (toman pedidos y cobran sus mesas); la cocina solo Cocina y Cafetería. La administradora crea y asigna los PIN en la pestaña "Garzones". Si olvidaste tu PIN, pídele a la administradora que te asigne uno nuevo.
- Para tomar un pedido: en "Mesas" toca la mesa, elige los productos (puedes agregar una nota) y toca Enviar. Lo de cocina llega a la pantalla de Cocina con sonido; lo de cafetería (cafés y bebidas calientes) sale directo de la mesa como entregado, sin que tengas que marcar nada.
- Para cobrar: abre la mesa en "Mesas" y toca Cobrar. Elige cómo paga el cliente (efectivo, tarjeta o transferencia). En efectivo escribes cuánto te entrega y la app calcula el vuelto; en tarjeta queda indicado; en transferencia te recuerda confirmar que llegó. Antes de cobrar puedes anotar la propina. Cada garzón cobra las mesas que él tomó.
- Al cobrar hay dos recuadros: propina en efectivo (el cliente se la da directo al garzón; no se suma al total) y propina o recargo con tarjeta (se suma a la cuenta). Quedan registradas por garzón en los reportes y en el CSV de ventas.
- Si en una mesa compartida alguien se retira antes, en el cobro elige "pagar por producto", marca lo que consumió esa persona y cóbralo. Eso se descuenta del total de la mesa y el resto sigue abierto para los demás.
- En "Carta y mesas" cada producto tiene una estación: Cocina o Cafetería. Los cafés y bebidas calientes se marcan como Cafetería: los preparan los garzones y salen directo de la mesa, sin pasar por cocina. La pestaña "Cafetería" muestra esos pedidos.
- La pantalla "Cocina" muestra las comandas que llegan. La cocinera marca cuando están listas y a los garzones les avisa con sonido que pueden llevarlas a la mesa. Para el dispositivo fijo de la cocina, la administradora crea las cocineras con PIN; ese equipo queda abierto y vuelve solo a Cocina si se recarga. Toca el botón de activar sonido una vez.
- Arriba hay un botón "Sonido". Tócalo para activarlo (los navegadores exigen un toque primero). En la cocina aparece un botón grande azul para activar el sonido de las comandas. Revisa también el volumen del equipo y que la pestaña esté abierta. La administradora recibe todas las notificaciones.
- La venta por mostrador (productos sin mesa) la hacen la administradora y los garzones autorizados con PIN. Entra a "Mesas" y toca "+ Venta mostrador". Puedes buscar productos por nombre o escanear el código de barras. La administradora autoriza a cada garzón desde la pestaña "Garzones".
- Con un lector de código de barras conectado al PC puedes escanear productos en la venta por mostrador y en Inventario (para ingresar stock o crear productos nuevos). Haz clic en el campo de escaneo y escanea. Si el código no existe, la app te ofrece registrarlo. Cada producto tiene su código en el campo "Código".
- En "Inventario" ves el stock de cada producto, ingresas mercadería (por código de barras o a mano) y puedes corregir el precio de un producto. Cuando el stock llega al mínimo aparece una alerta en la pestaña. Los productos agotados dejan de poder pedirse. Los precios y la carta también se editan en "Carta y mesas".
- La carta se edita en "Carta y mesas": agrega productos con nombre, categoría, precio, estación (Cocina o Cafetería) y, si quieres, código de barras y stock. Puedes marcar un producto como agotado sin borrarlo. Allí mismo configuras la cantidad de mesas del local y las del segundo piso.
- La cantidad de mesas (y las del segundo piso) se configura en "Carta y mesas". El segundo piso aparece como "Piso 2 · Mesa N" en toda la app.
- Los garzones se crean en la pestaña "Garzones" (solo la administradora): agrega el nombre, asígnale un PIN y, si corresponde, autorízalo para cobrar por mostrador. Cada mesa solo la maneja el garzón que la tomó, y un garzón sin PIN no puede entrar a mesas de otros.
- En la pestaña "Caja" se abre el turno con el monto inicial en efectivo y al final del día se cierra contando el efectivo: la app muestra lo esperado, lo contado y la diferencia, con ventas por método de pago y propinas. Queda registrado quién estuvo en caja en cada turno.
- La pestaña "Ventas" (solo administradora) muestra las ventas del día y reportes por fechas, por garzón y por método de pago, con propinas. Puedes descargar un CSV para abrirlo en Excel.
- En la pestaña "Comandas" la administradora puede revisar todas las comandas enviadas por cada garzón, útil para detectar errores en ventas.
- En "Reservas" anotas fecha, hora, nombre, personas y mesa. La mesa aparece como "Reservada" en el plano de Mesas y la administradora recibe un aviso unos minutos antes de la hora.
- En "Mesas", sobre el plano, hay botones "+ Para llevar" y "+ Delivery". Escribe nombre, teléfono (y dirección en delivery), toma el pedido como una mesa y cóbralo igual. Los pedidos abiertos aparecen listados con su número.
- Cada mesa la maneja el garzón que tomó el pedido. Si necesitas ayudar en una mesa de otro garzón, la administradora (o un garzón autorizado con PIN) puede abrirla y cobrarla.
- Prueba esto: 1) recarga la página; 2) revisa que el equipo tenga internet; 3) cierra y vuelve a abrir el navegador. La app necesita conexión para funcionar y se actualiza sola al volver el internet. Si el problema sigue, toca "Hablar con una persona" y cuéntanos qué pasó.
- Protech Resto es una página web: funciona en celular, tablet y PC con solo abrir resto.protechdigital.cl en el navegador. Puedes agregarla a la pantalla de inicio del celular desde el menú del navegador. Cada persona entra con su PIN en su propio equipo.
- Para nuevos locales, planes o temas de pago escríbele a Protech por WhatsApp: +56 9 3947 3588. Las cuentas las crea Protech (no hay registro público) y cada local ve solo sus propios datos.
- Si te equivocaste en un pedido que aún no se cobró, ábrelo desde "Mesas" y corrígelo antes de cobrar. Para anular ventas ya cobradas o corregir datos, avisa a la administradora o escríbenos con "Hablar con una persona" para revisarlo juntos.`;

const SISTEMA = `Eres el asistente de ayuda de "Protech Resto", un sistema web de pedidos, comandas y caja para restaurantes y cafeterías, creado por Protech (Chile). Hablas con el personal de un local (administradora, garzones, cocina). Responde SIEMPRE en español de Chile, claro, cálido y breve (máximo 6 líneas), sin markdown ni asteriscos. Usa los nombres reales de las pestañas: Mesas, Cocina, Cafetería, Reservas, Caja, Ventas, Inventario, Garzones, Comandas, Carta y mesas.

Reglas:
- Responde solo sobre cómo usar Protech Resto, basándote en la GUÍA. No inventes botones, pantallas ni funciones que la guía no mencione. Si algo no está en la guía y no estás seguro, dilo con honestidad.
- Si la persona describe una falla, un error, un dato incorrecto, un cobro mal hecho, quiere algo que el sistema no hace, o necesita algo de precios/contratos/cuentas, o pide hablar con una persona, o no puedes ayudar con certeza: ayuda en lo que puedas y termina tu respuesta con la marca [[HUMANO]] para que soporte de Protech la atienda.
- No pidas ni repitas claves, PIN ni datos de tarjetas. No des consejos legales ni tributarios.
- Si preguntan algo ajeno al sistema, di amablemente que solo ayudas con Protech Resto.
- Soporte Protech por WhatsApp: +56 9 3947 3588.

GUÍA DEL SISTEMA:
${GUIA}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  try {
    const clave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!clave) return json({ error: "sin_clave" }, 503);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: eu } = await admin.auth.getUser(token);
    if (eu || !u?.user) return json({ error: "sin_sesion" }, 401);
    const { data: mi } = await admin.from("resto_miembros").select("local_id").eq("user_id", u.user.id).maybeSingle();
    if (!mi) return json({ error: "sin_local" }, 403);

    const desde = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("resto_chat").select("id", { count: "exact", head: true })
      .eq("local_id", mi.local_id).eq("autor", "bot").gte("created_at", desde);
    if ((count ?? 0) >= LIMITE_POR_HORA) return json({ error: "limite" }, 429);

    const body = await req.json().catch(() => ({}));
    const crudos = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    const msgs: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of crudos) {
      const role = m?.role === "assistant" ? "assistant" : "user";
      const content = String(m?.content ?? "").slice(0, 600).trim();
      if (!content) continue;
      if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + content;
      else msgs.push({ role, content });
    }
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "mensaje" }, 400);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELO, max_tokens: 500, system: SISTEMA, messages: msgs }),
    });
    if (!r.ok) return json({ error: "ia", detalle: r.status }, 502);
    const j = await r.json();
    let texto = (j.content || []).map((c: { text?: string }) => c.text || "").join("").trim();
    const humano = texto.includes("[[HUMANO]]");
    texto = texto.replace(/\[\[HUMANO\]\]/g, "").trim();
    if (!texto) return json({ error: "vacio" }, 502);
    return json({ texto, humano });
  } catch (e) {
    return json({ error: "interno", detalle: String(e).slice(0, 120) }, 500);
  }
});

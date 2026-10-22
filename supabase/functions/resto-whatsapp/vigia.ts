// Reglas del vigía: miran una "foto" del sistema y devuelven los avisos que corresponde mandar.
// Módulo puro (sin base de datos ni red): recibe datos y devuelve avisos, así se puede probar con `node --test`.
// Cada aviso lleva una `clave` estable: la base guarda las claves ya avisadas y nunca se repite el mismo aviso.
import { duracion, fechaChile, pesos } from "./tiempo.ts";

export type Gravedad = "alta" | "media" | "baja";
export type Destino = "ingeniero" | "admin";

export interface Aviso {
  local_id: string;
  clave: string;
  gravedad: Gravedad;
  titulo: string;
  detalle: string;
  /** Quién debe enterarse. Las alertas técnicas van solo al ingeniero; las de caja también a la administradora. */
  para: Destino[];
}

export interface LocalV { id: string; nombre: string; control_caja: boolean }
export interface TurnoV { id: string; local_id: string; abierto_por: string | null; abierto_at: string; cerrado_at: string | null }
export interface AnulacionV { id: string; local_id: string; item_n: string; cantidad: number; mesa: number; pedida_por: string | null; created_at: string }
export interface PinV { local_id: string; fallos: number; bloqueado_hasta: string | null }
export interface AlertaCtrlV { id: string; local_id: string; gravedad: Gravedad; titulo: string; detalle: string; created_at: string; visto_at: string | null }
export interface RevisionV { turno_id: string; fase: "apertura" | "cierre" }

export interface Foto {
  ahora: Date;
  locales: LocalV[];
  /** Turnos abiertos (sin cerrar). */
  turnosAbiertos: TurnoV[];
  /** Turnos abiertos o cerrados en las últimas 24 h, para comprobar que el control de caja los revisó. */
  turnosRecientes: TurnoV[];
  revisiones: RevisionV[];
  anulacionesPendientes: AnulacionV[];
  pines: PinV[];
  alertasControl: AlertaCtrlV[];
  /** Cantidad de celulares con avisos push activados, por local. */
  pushPorLocal: Record<string, number>;
}

export const UMBRAL = {
  turnoLargoMin: 12 * 60,        // caja abierta hace más de 12 h
  turnoSinCerrarMin: 18 * 60,    // caja abierta hace más de 18 h: casi seguro quedó sin cerrar
  anulacionSinAtenderMin: 10,    // solicitud de anulación sin respuesta
  alertaSinVerMin: 30,           // alerta alta del control de caja que nadie ha visto
  controlSinRevisarMin: 5,       // el control de caja debió revisar la apertura o el cierre
  pinFallosAlerta: 5,            // intentos fallidos de clave que merecen aviso
};

const min = (desde: string, ahora: Date) => (ahora.getTime() - new Date(desde).getTime()) / 60000;

export function evaluar(f: Foto): Aviso[] {
  const out: Aviso[] = [];
  const nombre = (id: string) => f.locales.find((l) => l.id === id)?.nombre || "local";
  const hoy = fechaChile(f.ahora);

  // 1) Cajas abiertas demasiado tiempo
  for (const t of f.turnosAbiertos) {
    const m = min(t.abierto_at, f.ahora);
    if (m >= UMBRAL.turnoSinCerrarMin) {
      out.push({
        local_id: t.local_id, clave: `turno_sin_cerrar:${t.id}`, gravedad: "alta", para: ["ingeniero", "admin"],
        titulo: "Caja sin cerrar",
        detalle: `La caja de ${nombre(t.local_id)} lleva abierta ${duracion(m)} (la abrió ${t.abierto_por || "alguien"}). Probablemente quedó sin cerrar; hay que cerrarla en la pestaña Caja.`,
      });
    } else if (m >= UMBRAL.turnoLargoMin) {
      out.push({
        local_id: t.local_id, clave: `turno_largo:${t.id}`, gravedad: "media", para: ["ingeniero", "admin"],
        titulo: "Caja abierta hace mucho",
        detalle: `La caja de ${nombre(t.local_id)} lleva abierta ${duracion(m)} (la abrió ${t.abierto_por || "alguien"}).`,
      });
    }
  }

  // 2) Solicitudes de anulación sin atender
  for (const a of f.anulacionesPendientes) {
    const m = min(a.created_at, f.ahora);
    if (m >= UMBRAL.anulacionSinAtenderMin) {
      out.push({
        local_id: a.local_id, clave: `anulacion:${a.id}`, gravedad: "media", para: ["admin"],
        titulo: "Anulación sin responder",
        detalle: `${a.pedida_por || "Un garzón"} pide anular ${a.cantidad}× ${a.item_n} (mesa ${a.mesa}) hace ${duracion(m)} y nadie la ha aprobado ni rechazado.`,
      });
    }
  }

  // 3) Claves bloqueadas por intentos fallidos (no se muestra de quién es la clave)
  for (const p of f.pines) {
    const bloqueada = p.bloqueado_hasta && new Date(p.bloqueado_hasta) > f.ahora;
    if (bloqueada || p.fallos >= UMBRAL.pinFallosAlerta) {
      out.push({
        local_id: p.local_id, clave: `pin:${p.local_id}:${p.bloqueado_hasta || "f" + p.fallos}`, gravedad: "alta", para: ["ingeniero", "admin"],
        titulo: "Intentos fallidos de clave",
        detalle: `En ${nombre(p.local_id)} hubo ${p.fallos} intentos fallidos de PIN${bloqueada ? " y una clave quedó bloqueada" : ""}. Conviene preguntar quién estaba intentando entrar.`,
      });
    }
  }

  // 4) Alertas altas del control de caja que nadie ha visto
  for (const a of f.alertasControl) {
    if (a.gravedad === "alta" && !a.visto_at && min(a.created_at, f.ahora) >= UMBRAL.alertaSinVerMin) {
      out.push({
        local_id: a.local_id, clave: `ctrl_sin_ver:${a.id}`, gravedad: "alta", para: ["ingeniero", "admin"],
        titulo: "Alerta de caja sin revisar",
        detalle: `${a.titulo}: ${a.detalle}`.slice(0, 400),
      });
    }
  }

  // 5) Salud del propio sistema: el control de caja no revisó una apertura o un cierre
  const revisado = new Set(f.revisiones.map((r) => `${r.turno_id}:${r.fase}`));
  const conControl = new Set(f.locales.filter((l) => l.control_caja).map((l) => l.id));
  for (const t of f.turnosRecientes) {
    if (!conControl.has(t.local_id)) continue;
    if (min(t.abierto_at, f.ahora) >= UMBRAL.controlSinRevisarMin && !revisado.has(`${t.id}:apertura`)) {
      out.push({
        local_id: t.local_id, clave: `sin_revision:${t.id}:apertura`, gravedad: "media", para: ["ingeniero"],
        titulo: "El control de caja no revisó una apertura",
        detalle: `La apertura de ${t.abierto_por || "alguien"} en ${nombre(t.local_id)} no tiene revisión. Revisa que la función resto-control-caja esté publicada y su disparador activo.`,
      });
    }
    if (t.cerrado_at && min(t.cerrado_at, f.ahora) >= UMBRAL.controlSinRevisarMin && !revisado.has(`${t.id}:cierre`)) {
      out.push({
        local_id: t.local_id, clave: `sin_revision:${t.id}:cierre`, gravedad: "media", para: ["ingeniero"],
        titulo: "El control de caja no revisó un cierre",
        detalle: `El cierre de ${nombre(t.local_id)} no tiene revisión. Revisa que la función resto-control-caja esté publicada y su disparador activo.`,
      });
    }
  }

  // 6) Nadie recibe avisos push en un local con control de caja (una vez al día)
  for (const l of f.locales) {
    if (l.control_caja && !(f.pushPorLocal[l.id] > 0)) {
      out.push({
        local_id: l.id, clave: `sin_push:${l.id}:${hoy}`, gravedad: "media", para: ["ingeniero"],
        titulo: "Nadie recibe avisos push",
        detalle: `${l.nombre} tiene el control de caja activo pero ningún celular con avisos activados.`,
      });
    }
  }

  return out;
}

// ---------- Textos de apertura y cierre ----------
export interface TurnoTexto {
  abierto_por: string | null; abierto_at: string; monto_inicial: number | null;
  cerrado_por?: string | null; cerrado_at?: string | null;
  ventas_total?: number | null; cuentas?: number | null; ventas_tarjeta?: number | null; ventas_transf?: number | null;
  esperado_efectivo?: number | null; contado_efectivo?: number | null; diferencia?: number | null;
}
export interface ResultadoControl { listo: boolean; alertas: { gravedad: Gravedad; titulo: string }[] }

function lineaControl(c: ResultadoControl): string {
  if (!c.listo) return "Control de caja: aún revisando.";
  if (!c.alertas.length) return "Control de caja: sin alertas ✅";
  const altas = c.alertas.filter((a) => a.gravedad === "alta").length;
  const lista = c.alertas.slice(0, 3).map((a) => "• " + a.titulo).join("\n");
  return `Control de caja: ${c.alertas.length} alerta${c.alertas.length === 1 ? "" : "s"}${altas ? ` (${altas} alta${altas === 1 ? "" : "s"})` : ""} ⚠️\n${lista}`;
}

export function textoApertura(local: string, t: TurnoTexto, hora: string, c: ResultadoControl): { titulo: string; cuerpo: string } {
  return {
    titulo: `Caja abierta · ${local}`,
    cuerpo: `${t.abierto_por || "Alguien"} abrió la caja a las ${hora} con ${pesos(t.monto_inicial)} de sencillo.\n${lineaControl(c)}`,
  };
}

export function textoCierre(local: string, t: TurnoTexto, hora: string, c: ResultadoControl): { titulo: string; cuerpo: string } {
  const dif = t.diferencia == null ? "" : t.diferencia === 0 ? "Cuadra exacto." : t.diferencia > 0 ? `Sobran ${pesos(t.diferencia)}.` : `Faltan ${pesos(-t.diferencia)}.`;
  const efectivo = t.esperado_efectivo != null && t.contado_efectivo != null ? `Efectivo esperado ${pesos(t.esperado_efectivo)}, contado ${pesos(t.contado_efectivo)}. ${dif}` : "";
  return {
    titulo: `Caja cerrada · ${local}`,
    cuerpo: [
      `${t.cerrado_por || "Alguien"} cerró la caja a las ${hora} (la abrió ${t.abierto_por || "alguien"}).`,
      `Ventas ${pesos(t.ventas_total)} en ${t.cuentas ?? 0} cuentas · tarjetas ${pesos(t.ventas_tarjeta)} · transferencias ${pesos(t.ventas_transf)}.`,
      efectivo,
      lineaControl(c),
    ].filter(Boolean).join("\n"),
  };
}

/** Texto de un aviso del vigía para WhatsApp. */
export function textoAviso(a: Aviso, local: string): string {
  const icono = a.gravedad === "alta" ? "🔴" : a.gravedad === "media" ? "🟠" : "🟡";
  return `${icono} ${a.titulo} · ${local}\n${a.detalle}`;
}

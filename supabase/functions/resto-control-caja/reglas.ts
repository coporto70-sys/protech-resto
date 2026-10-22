// Protech Resto · control de caja · reglas que detectan posibles errores de ingreso
// Archivo SIN dependencias: son funciones puras (reciben datos, devuelven alertas). Las cifras salen de aquí,
// nunca de la IA. Se prueba con: node --test supabase/functions/resto-control-caja/reglas.test.ts

export type Den = Record<string, number>; // { "20000": 4, "1000": 80, ... } billetes/monedas contados

export interface Turno {
  id: string;
  local_id: string;
  abierto_por?: string | null;
  abierto_at: string;
  cerrado_at: string | null;
  cerrado_por?: string | null;
  monto_inicial?: number | null;
  esperado_efectivo?: number | null;
  contado_efectivo?: number | null;
  diferencia?: number | null;
  ventas_total?: number | null;
  ventas_efectivo?: number | null;
  ventas_tarjeta?: number | null;
  ventas_transf?: number | null;
  retiro_efectivo?: number | null;
  gastos_total?: number | null;
  propinas_pagadas?: number | null;
  cuentas?: number | null;
  nota?: string | null;
  desglose_apertura?: Den | null;
  desglose_deja?: Den | null;
  desglose_cierre?: {
    efectivo?: Den;
    tarjeta?: number | null;
    transferencia?: number | null;
    dif_tarjeta?: number | null;
    dif_transferencia?: number | null;
  } | null;
}

// Fila de resto_gastos. Los retiros de efectivo también viven ahí con tipo = 'Retiro'.
export interface Gasto {
  id?: string;
  tipo: string; // Boleta | Factura | Sin documento | Retiro
  numero?: string | null;
  proveedor?: string | null;
  detalle?: string | null;
  monto: number;
  monto_original?: number | null; // si la administradora lo corrigió, aquí queda el monto digitado primero
  anulado?: boolean | null;
  created_at: string;
}

export type Gravedad = "alta" | "media" | "baja";

export interface Alerta {
  regla: string;
  gravedad: Gravedad;
  titulo: string; // corto, para el aviso
  detalle: string; // qué se vio, con cifras
  revisar: string; // qué conviene revisar
}

export interface Contexto {
  fondo: number; // sencillo fijo del local (resto_locales.fondo_caja)
  retirosRecientes: Gasto[]; // todos los retiros del local en las 24 h previas al cierre (incluye anulados y los de este turno)
}

// Valores de partida. La administradora los puede ajustar con la experiencia.
export const UMBRALES = {
  difMedia: 5_000, // diferencia de caja desde la que se avisa
  difAlta: 50_000, // diferencia de caja que se considera grave
  monedasMax: 500, // más monedas que esto de una misma denominación = probable error de tipeo
  billetesMax: 300, // idem para billetes
  gastoGrande: 150_000, // un gasto de compra por este monto o más se avisa
  turnoLargoHoras: 16, // un turno abierto más tiempo que esto se avisa
  retiroRepetidoHoras: 24, // ventana para detectar el mismo retiro cargado dos veces
  aperturaDifAlta: 20_000, // diferencia entre el sencillo recibido y el fijo/anterior que se considera grave
};

const RANGO: Record<Gravedad, number> = { alta: 0, media: 1, baja: 2 };

export const pesos = (n: number): string =>
  "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export const totalDen = (d?: Den | null): number =>
  Object.entries(d || {}).reduce((a, [v, c]) => a + Number(v) * Number(c), 0);

const nDen = (d?: Den | null): number => Object.keys(d || {}).length;

const DOC_INVALIDO = /^(retiro|sin\s*documento|s\/?d|n\/?a|x+|-+|0+)$/i;

export function ordenar(alertas: Alerta[]): Alerta[] {
  return [...alertas].sort((a, b) => RANGO[a.gravedad] - RANGO[b.gravedad]);
}

export function revisarTurno(t: Turno, gastos: Gasto[], ctx: Contexto, u = UMBRALES): Alerta[] {
  const out: Alerta[] = [];
  const add = (regla: string, gravedad: Gravedad, titulo: string, detalle: string, revisar: string) =>
    out.push({ regla, gravedad, titulo, detalle, revisar });

  const dc = t.desglose_cierre || {};
  const contado = t.contado_efectivo ?? null;
  const ventas = t.ventas_total ?? 0;
  const fondo = ctx.fondo || 0;
  const vigentes = gastos.filter((g) => !g.anulado);
  const retiros = vigentes.filter((g) => g.tipo === "Retiro");
  const compras = vigentes.filter((g) => g.tipo !== "Retiro");

  // 1) Tarjetas: lo anotado vs lo que el sistema calculó con los cobros
  const tj = dc.tarjeta ?? null;
  const difTj = dc.dif_tarjeta ?? (tj != null && t.ventas_tarjeta != null ? tj - t.ventas_tarjeta : null);
  if (tj != null && difTj != null && Math.abs(difTj) >= u.difMedia) {
    const g: Gravedad = Math.abs(difTj) >= u.difAlta ? "alta" : "media";
    const pista = tj > ventas && ventas > 0 ? " Es más que todas las ventas del turno: ¿se anotó el total del día de la máquina?" : "";
    add("tarjeta_no_cuadra", g, "Tarjetas no cuadran",
      `Se anotaron ${pesos(tj)} en tarjetas y el sistema espera ${pesos(tj - difTj)} (diferencia ${pesos(Math.abs(difTj))}).${pista}`,
      "Revisar el comprobante de la máquina de tarjetas de este turno.");
  } else if (tj != null && difTj == null && ventas > 0 && tj > ventas * 1.25 + 1_000) {
    add("tarjeta_no_cuadra", "alta", "Tarjetas más altas que las ventas",
      `Se anotaron ${pesos(tj)} en tarjetas y las ventas del turno fueron ${pesos(ventas)}.`,
      "Revisar el comprobante de la máquina: ¿es del turno o del día completo?");
  }

  // 2) Transferencias
  const difTr = dc.dif_transferencia ?? null;
  if (difTr != null && Math.abs(difTr) >= u.difMedia) {
    add("transferencia_no_cuadra", "media", "Transferencias no cuadran",
      `La diferencia en transferencias es ${pesos(Math.abs(difTr))} (se anotaron ${pesos(dc.transferencia ?? 0)}).`,
      "Revisar las transferencias recibidas en el banco durante el turno.");
  }

  // 3) Apertura sin sencillo registrado
  if (fondo > 0 && !((t.monto_inicial ?? 0) > 0)) {
    add("apertura_sin_sencillo", "alta", "Caja abierta sin sencillo",
      `El turno se abrió sin registrar sencillo, pero el sencillo fijo del local es ${pesos(fondo)}. Por eso el cierre puede mostrar una diferencia que no es real.`,
      "Confirmar cuánto sencillo había al abrir y corregir la diferencia con una observación.");
  } else if ((t.monto_inicial ?? 0) > 0 && nDen(t.desglose_apertura) === 0) {
    add("apertura_sin_detalle", "baja", "Apertura sin detalle de billetes",
      "El sencillo inicial no tiene el detalle de billetes y monedas.",
      "Pedir que cuenten el sencillo por denominación al abrir.");
  }

  // 4) Solo se contó el sencillo
  if (contado != null && fondo > 0 && contado === fondo && (t.ventas_efectivo ?? 1) > 0 && !((t.retiro_efectivo ?? 0) > 0)) {
    add("contado_igual_sencillo", "media", "Efectivo contado = solo el sencillo",
      `El efectivo contado (${pesos(contado)}) es exactamente el sencillo fijo y no se retiró efectivo de ventas.`,
      "Confirmar que se contó también el efectivo de las ventas.");
  }

  // 5) Contado igual a un retiro del mismo turno
  if (contado != null && contado > 0) {
    const r = retiros.find((x) => x.monto === contado);
    if (r) {
      add("contado_igual_retiro", "alta", "Efectivo contado = un retiro",
        `El efectivo contado (${pesos(contado)}) es igual a un retiro registrado en este turno. Puede que se anotó lo retirado en vez de lo que quedó en caja.`,
        "Recontar el efectivo que quedó en la caja.");
    }
  }

  // 6) Contado igual al total de ventas
  if (contado != null && contado > 0 && ventas > 0 && contado === ventas) {
    add("contado_igual_ventas", "media", "Efectivo contado = total de ventas",
      `El efectivo contado (${pesos(contado)}) es igual al total de ventas del turno, que incluye tarjetas.`,
      "Recontar solo el efectivo físico.");
  }

  // 7) Cantidades absurdas de billetes o monedas
  const conteos: Array<[string, Den | null | undefined]> = [["efectivo contado", dc.efectivo], ["sencillo que queda", t.desglose_deja], ["sencillo inicial", t.desglose_apertura]];
  for (const [cual, d] of conteos) {
    for (const [v, c] of Object.entries(d || {})) {
      const max = Number(v) <= 500 ? u.monedasMax : u.billetesMax;
      if (Number(c) > max) {
        add("cantidad_absurda", "media", "Cantidad de billetes o monedas poco creíble",
          `En ${cual} figuran ${c} de ${pesos(Number(v))}.`,
          "Revisar el conteo: probablemente hay un cero o dígito de más.");
      }
    }
  }

  // 8) Diferencia de efectivo
  const dif = t.diferencia ?? (contado != null && t.esperado_efectivo != null ? contado - t.esperado_efectivo : null);
  if (dif != null && Math.abs(dif) >= u.difMedia) {
    const g: Gravedad = Math.abs(dif) >= u.difAlta ? "alta" : "media";
    add("diferencia_efectivo", g, dif > 0 ? "Sobra efectivo" : "Falta efectivo",
      `${dif > 0 ? "Sobran" : "Faltan"} ${pesos(Math.abs(dif))} (esperado ${pesos(t.esperado_efectivo ?? 0)}, contado ${pesos(contado ?? 0)}).${t.nota ? ` Observación: ${t.nota}.` : ""}`,
      "Recontar y revisar gastos, retiros y propinas pagadas del turno.");
  }

  // 9) Retiro repetido: mismo monto (o el monto original antes de corregirlo) en menos de 24 h
  for (const r of retiros) {
    const tr = new Date(r.created_at).getTime();
    const otro = ctx.retirosRecientes.find((o) => {
      if (o === r || (o.id && o.id === r.id)) return false;
      if (Math.abs(new Date(o.created_at).getTime() - tr) > u.retiroRepetidoHoras * 3_600_000) return false;
      return o.monto === r.monto || o.monto_original === r.monto;
    });
    if (otro) {
      add("retiro_repetido", "media", "Posible retiro repetido",
        `Hay un retiro de ${pesos(r.monto)} y otro por el mismo monto en menos de ${u.retiroRepetidoHoras} horas${otro.anulado ? " (anulado)" : ""}.`,
        "Confirmar que no se cargó dos veces el mismo retiro.");
    }
  }

  // 10) Gastos sin documento válido
  for (const g of compras) {
    if (g.tipo === "Sin documento") continue; // lo declararon así: se controla con el monto
    const n = (g.numero || "").trim();
    if (!n || !/\d/.test(n) || DOC_INVALIDO.test(n)) {
      add("gasto_sin_documento", "media", "Gasto sin número de documento válido",
        `El gasto de ${pesos(g.monto)}${g.proveedor ? ` (${g.proveedor})` : ""} figura como ${g.tipo} con número "${n || "vacío"}".`,
        "Pedir el número real de la boleta o factura, o marcarlo como Sin documento.");
    }
  }

  // 11) Gasto de compra muy alto
  for (const g of compras) {
    if (g.monto >= u.gastoGrande) {
      add("gasto_grande", "media", "Gasto de monto alto",
        `Gasto de ${pesos(g.monto)}${g.proveedor ? ` a ${g.proveedor}` : ""}${g.detalle ? ` (${g.detalle})` : ""}.`,
        "Confirmar que el monto está bien digitado (¿ceros de más?).");
    }
  }

  // 12) Turno abierto demasiado tiempo
  if (t.cerrado_at) {
    const horas = (new Date(t.cerrado_at).getTime() - new Date(t.abierto_at).getTime()) / 3_600_000;
    if (horas > u.turnoLargoHoras) {
      add("turno_largo", "baja", "Turno muy largo",
        `El turno estuvo abierto ${Math.round(horas)} horas.`,
        "Cerrar la caja al terminar cada día para no mezclar jornadas.");
    }
  }

  return ordenar(out);
}

// Texto corto para la notificación push (el celular muestra poco)
export function resumenPush(alertas: Alerta[]): { titulo: string; cuerpo: string } {
  const n = alertas.length;
  const titulo = n === 1 ? "Revisión de caja: 1 alerta" : `Revisión de caja: ${n} alertas`;
  const cuerpo = ordenar(alertas).slice(0, 3).map((a) => a.titulo).join(" · ");
  return { titulo, cuerpo: cuerpo.slice(0, 180) };
}

// ---------- Apertura de caja ----------
export interface ContextoApertura {
  fondo: number; // sencillo fijo del local
  anteriorDeja: number | null; // sencillo que dejó el turno anterior al cerrar (null si no hay turno anterior)
}

// Revisa el conteo del sencillo al abrir la caja. Se llama apenas se abre el turno.
export function revisarApertura(t: Turno, ctx: ContextoApertura, u = UMBRALES): Alerta[] {
  const out: Alerta[] = [];
  const add = (regla: string, gravedad: Gravedad, titulo: string, detalle: string, revisar: string) =>
    out.push({ regla, gravedad, titulo, detalle, revisar });
  const inicial = t.monto_inicial ?? 0;
  const fondo = ctx.fondo || 0;
  const por = t.abierto_por ? ` por ${t.abierto_por}` : "";

  if (fondo > 0 && inicial <= 0) {
    add("apertura_sin_sencillo", "alta", "Caja abierta sin sencillo",
      `La caja se abrió${por} sin registrar sencillo, pero el sencillo fijo del local es ${pesos(fondo)}. El cierre mostrará una diferencia que no es real.`,
      "Contar el sencillo que hay en la caja y registrarlo antes de seguir cobrando.");
  } else if (inicial > 0) {
    if (nDen(t.desglose_apertura) === 0) {
      add("apertura_sin_detalle", "media", "Apertura sin detalle de billetes",
        `La caja se abrió${por} con ${pesos(inicial)}, pero sin el detalle de billetes y monedas.`,
        "Pedir que cuenten el sencillo por denominación.");
    } else if (totalDen(t.desglose_apertura) !== inicial) {
      add("apertura_no_suma", "alta", "El conteo de apertura no suma",
        `El sencillo inicial es ${pesos(inicial)} pero los billetes y monedas anotados suman ${pesos(totalDen(t.desglose_apertura))}.`,
        "Recontar el sencillo al abrir.");
    }
    if (fondo > 0 && inicial !== fondo) {
      const g: Gravedad = Math.abs(inicial - fondo) >= u.aperturaDifAlta ? "alta" : "media";
      add("apertura_distinta_fondo", g, "Sencillo de apertura distinto al fijo",
        `Se abrió${por} con ${pesos(inicial)} y el sencillo fijo es ${pesos(fondo)} (${inicial > fondo ? "sobran" : "faltan"} ${pesos(Math.abs(inicial - fondo))}).`,
        "Confirmar el conteo, o actualizar el sencillo fijo si cambió.");
    }
    if (ctx.anteriorDeja != null && ctx.anteriorDeja > 0 && inicial !== ctx.anteriorDeja) {
      add("apertura_distinta_anterior", "media", "No coincide con lo que dejó el turno anterior",
        `El turno anterior dejó ${pesos(ctx.anteriorDeja)} en la caja y se recibió con ${pesos(inicial)}.`,
        "Revisar si se movió dinero entre un turno y el otro.");
    }
    for (const [v, c] of Object.entries(t.desglose_apertura || {})) {
      if (Number(c) > (Number(v) <= 500 ? u.monedasMax : u.billetesMax)) {
        add("cantidad_absurda", "media", "Cantidad de billetes o monedas poco creíble",
          `En el sencillo inicial figuran ${c} de ${pesos(Number(v))}.`,
          "Revisar el conteo: probablemente hay un cero o dígito de más.");
      }
    }
  }
  return ordenar(out);
}

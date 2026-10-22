// Hora de Chile (America/Santiago) sin librerías: el local trabaja en hora chilena y la base guarda UTC.
// Módulo puro (sin Deno ni red) para poder probarlo con `node --test`.

export const ZONA = "America/Santiago";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function partes(d: Date) {
  const o: Record<string, number> = {};
  for (const p of fmt.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}

/** Minutos que Chile está adelantado respecto de UTC en ese instante (negativo: UTC-3 = -180, UTC-4 = -240). */
export function offsetMin(d: Date): number {
  const p = partes(d);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-22" para un instante, según la hora de Chile. */
export function fechaChile(d: Date = new Date()): string {
  const p = partes(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "09:00" para un instante, según la hora de Chile. */
export function horaChile(d: Date): string {
  const p = partes(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "22/10 09:00" */
export function fechaHoraCorta(d: Date): string {
  const p = partes(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Instante UTC en que empieza el día `yyyy-mm-dd` en Chile (00:00 hora chilena). */
export function inicioDiaChile(fecha: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error("Fecha inválida (usa AAAA-MM-DD): " + fecha);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);
  // Se prueban los desfases vigentes un día antes, ese día y un día después (verano e invierno). Así funciona también
  // cuando el cambio de horario cae justo a medianoche (en Chile pasa en septiembre y abril).
  const candidatos = new Set<number>();
  for (const dia of [-1, 0, 1]) {
    candidatos.add(guess - offsetMin(new Date(guess + dia * 86400000)) * 60000);
  }
  const delDia = [...candidatos].filter((c) => fechaChile(new Date(c)) === fecha).sort((a, b) => a - b);
  const medianoche = delDia.find((c) => { const p = partes(new Date(c)); return p.hour === 0 && p.minute === 0; });
  // Si la medianoche no existe (el reloj salta de las 24:00 a la 01:00), el día empieza en la primera hora que sí existe.
  return new Date(medianoche ?? delDia[0]);
}

/** Rango [desde, hasta) de un día completo en hora chilena. */
export function rangoDiaChile(fecha: string): { desde: Date; hasta: Date } {
  const desde = inicioDiaChile(fecha);
  const sig = new Date(Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)) - 1, Number(fecha.slice(8, 10)) + 1));
  const hasta = inicioDiaChile(sig.toISOString().slice(0, 10));
  return { desde, hasta };
}

/** Suma días a una fecha "AAAA-MM-DD" (puede ser negativo). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)) - 1, Number(fecha.slice(8, 10)) + dias));
  return d.toISOString().slice(0, 10);
}

/** "$168.570" */
export function pesos(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "3 h 20 min" */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

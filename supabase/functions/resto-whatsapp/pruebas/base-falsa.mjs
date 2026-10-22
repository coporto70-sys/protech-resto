// Base de datos en memoria con la parte de la API de supabase-js que usa el agente.
const UNICOS = { resto_agente_avisos: [["local_id", "clave"]], resto_agente_msgs: [["wa_id"]], resto_wa_equipo: [["telefono"]] };
let n = 0;
const uuid = () => "id-" + (++n);
const esFecha = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const cmp = (a, b) => (esFecha(a) || esFecha(b)) ? new Date(a).getTime() - new Date(b).getTime() : (a > b) - (a < b);
const tabla = (t) => (globalThis.__TABLAS[t] ||= []);

function fila(q, r) {
  for (const f of q.filtros) if (!f(r)) return false;
  return true;
}

class Consulta {
  constructor(t) { this.t = t; this.filtros = []; this.modo = "select"; this.orden = null; this.lim = null; this.rango = null; this.una = null; this.cuenta = null; this.devolver = false; }
  select(cols, opts) { if (this.modo === "select") { this.cols = cols; } else this.devolver = true; if (opts?.count) this.cuenta = opts; return this; }
  insert(r) { this.modo = "insert"; this.nuevas = Array.isArray(r) ? r : [r]; return this; }
  upsert(r) { return this.insert(r); }
  update(p) { this.modo = "update"; this.parche = p; return this; }
  eq(c, v) { this.filtros.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filtros.push((r) => r[c] !== v); return this; }
  is(c, v) { this.filtros.push((r) => (r[c] ?? null) === v); return this; }
  not(c, op, v) { if (op === "is") this.filtros.push((r) => (r[c] ?? null) !== v); return this; }
  gte(c, v) { this.filtros.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
  gt(c, v) { this.filtros.push((r) => r[c] != null && cmp(r[c], v) > 0); return this; }
  lt(c, v) { this.filtros.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; }
  in(c, vs) { this.filtros.push((r) => vs.includes(r[c])); return this; }
  ilike(c, p) { const re = new RegExp("^" + p.replace(/%/g, ".*") + "$", "i"); this.filtros.push((r) => re.test(String(r[c] ?? ""))); return this; }
  or(txt) {
    const alts = txt.split(",").map((p) => { const [c, op, ...v] = p.split("."); return { c, op, v: v.join(".") }; });
    this.filtros.push((r) => alts.some(({ c, op, v }) => r[c] != null && (op === "gte" ? cmp(r[c], isNaN(v) ? v : Number(v)) >= 0 : op === "gt" ? cmp(r[c], isNaN(v) ? v : Number(v)) > 0 : false)));
    return this;
  }
  order(c, o) { this.orden = { c, asc: o?.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rango = [a, b]; return this; }
  maybeSingle() { this.una = "maybe"; return this; }
  single() { this.una = "single"; return this; }
  async ejecutar() {
    const filas = tabla(this.t);
    if (this.modo === "insert") {
      const creadas = [];
      for (const r of this.nuevas) {
        const nueva = { id: uuid(), created_at: new Date().toISOString(), ...r };
        for (const cols of UNICOS[this.t] || []) {
          if (cols.every((c) => nueva[c] != null) && filas.some((x) => cols.every((c) => x[c] === nueva[c]))) return { data: null, error: { message: "duplicate key" } };
        }
        filas.push(nueva); creadas.push(nueva);
      }
      return this.cerrar(this.devolver || this.una ? creadas : null);
    }
    let sel = filas.filter((r) => fila(this, r));
    if (this.modo === "update") {
      for (const r of sel) Object.assign(r, this.parche);
      return this.cerrar(this.devolver || this.una ? sel : null);
    }
    if (this.orden) sel = [...sel].sort((a, b) => (this.orden.asc ? 1 : -1) * cmp(a[this.orden.c] ?? "", b[this.orden.c] ?? ""));
    const total = sel.length;
    if (this.rango) sel = sel.slice(this.rango[0], this.rango[1] + 1);
    if (this.lim != null) sel = sel.slice(0, this.lim);
    const r = this.cerrar(sel);
    if (this.cuenta) r.count = total;
    if (this.cuenta?.head) r.data = null;
    return r;
  }
  cerrar(datos) {
    if (this.una && datos) return { data: datos[0] ?? null, error: this.una === "single" && !datos.length ? { message: "no rows" } : null };
    return { data: datos, error: null };
  }
  then(ok, ko) { return this.ejecutar().then(ok, ko); }
}

export function createClient() { return { from: (t) => new Consulta(t) }; }

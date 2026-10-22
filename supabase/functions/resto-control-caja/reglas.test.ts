// Pruebas de las reglas de control de caja. Ejecutar con:
//   node --test supabase/functions/resto-control-caja/reglas.test.ts
// Los casos salen de cierres reales de Super Pastel (oct 2026). Donde el sistema no mostraba un dato
// (por ejemplo lo que esperaba en tarjetas) se usa un valor estimado, marcado como "estimado".
import { test } from "node:test";
import assert from "node:assert/strict";
import { revisarTurno, resumenPush, pesos, type Turno, type Gasto } from "./reglas.ts";

const FONDO = 169_310;
const base = (o: Partial<Turno>): Turno => ({ id: "t", local_id: "l", abierto_at: "2026-10-21T10:00:00Z", cerrado_at: "2026-10-21T20:00:00Z", ...o });
const reglas = (t: Turno, g: Gasto[] = [], rec: Gasto[] = []) => revisarTurno(t, g, { fondo: FONDO, retirosRecientes: rec }).map((a) => a.regla);

test("formato de pesos", () => {
  assert.equal(pesos(1_000_000), "$1.000.000");
  assert.equal(pesos(444), "$444");
});

test("21/10 16:50 (Pedro): tarjetas mayores que las ventas, apertura sin sencillo, solo se contó el sencillo", () => {
  const t = base({
    monto_inicial: 0, desglose_apertura: null, ventas_total: 350_690, ventas_tarjeta: 300_000 /* estimado */,
    esperado_efectivo: 39_430, contado_efectivo: 169_310, diferencia: 129_880, retiro_efectivo: 0,
    desglose_cierre: { tarjeta: 929_536, transferencia: 0, efectivo: { "20000": 4, "1000": 80, "500": 11, "100": 23, "50": 13, "10": 86 } },
  });
  const r = reglas(t);
  assert.ok(r.includes("tarjeta_no_cuadra"));
  assert.ok(r.includes("apertura_sin_sencillo"));
  assert.ok(r.includes("contado_igual_sencillo"));
  assert.ok(r.includes("diferencia_efectivo"));
  const a = revisarTurno(t, [], { fondo: FONDO, retirosRecientes: [] });
  assert.equal(a[0].gravedad, "alta"); // lo más grave va primero
  assert.match(a.find((x) => x.regla === "tarjeta_no_cuadra")!.detalle, /total del día de la máquina/);
});

test("21/10 00:00 (Administradora): efectivo contado igual al retiro de $210.000", () => {
  const retiro: Gasto = { id: "r1", tipo: "Retiro", monto: 210_000, created_at: "2026-10-21T19:25:00Z" };
  const t = base({
    monto_inicial: FONDO, desglose_apertura: { "20000": 1 }, ventas_total: 693_760, contado_efectivo: 210_000,
    esperado_efectivo: 127_082, diferencia: 82_918, desglose_cierre: { tarjeta: 588_350, dif_tarjeta: 0, efectivo: { "20000": 10, "10000": 1 } },
  });
  const r = reglas(t, [retiro], [retiro]);
  assert.ok(r.includes("contado_igual_retiro"));
  assert.ok(r.includes("diferencia_efectivo"));
});

test("retiro de $210.000 repetido: el del día anterior se corrigió a $40.000 pero su monto original era $210.000", () => {
  const nuevo: Gasto = { id: "r2", tipo: "Retiro", monto: 210_000, created_at: "2026-10-21T19:25:00Z" };
  const viejo: Gasto = { id: "r1", tipo: "Retiro", monto: 40_000, monto_original: 210_000, created_at: "2026-10-21T02:55:00Z" };
  assert.ok(reglas(base({}), [nuevo], [nuevo, viejo]).includes("retiro_repetido"));
  // Sin el retiro anterior no hay alerta
  assert.ok(!reglas(base({}), [nuevo], [nuevo]).includes("retiro_repetido"));
});

test("15/10 19:42: $288.137 en tarjetas con ventas de $10.840", () => {
  const t = base({ ventas_total: 10_840, ventas_tarjeta: 10_840 /* estimado */, cuentas: 1, desglose_cierre: { tarjeta: 288_137, transferencia: 0 }, contado_efectivo: 0, esperado_efectivo: 0, diferencia: 0 });
  assert.ok(reglas(t).includes("tarjeta_no_cuadra"));
});

test("sin dato del sistema en tarjetas, se compara con las ventas totales", () => {
  const t = base({ ventas_total: 10_840, desglose_cierre: { tarjeta: 288_137 } });
  assert.ok(reglas(t).includes("tarjeta_no_cuadra"));
});

test("18/10 10:16: $444 en tarjetas cuando el sistema esperaba unos $189.000 (estimado)", () => {
  const t = base({ ventas_total: 440_500, ventas_tarjeta: 189_020, desglose_cierre: { tarjeta: 444, dif_tarjeta: 444 - 189_020 }, monto_inicial: FONDO, desglose_apertura: { "5000": 1 } });
  assert.ok(reglas(t).includes("tarjeta_no_cuadra"));
});

test("15/10 07:23: 3200 monedas de $50", () => {
  const t = base({ monto_inicial: FONDO, desglose_apertura: { "5000": 1 }, desglose_cierre: { efectivo: { "20000": 14, "50": 3200 } } });
  assert.ok(reglas(t).includes("cantidad_absurda"));
});

test("14/10 10:59: efectivo contado igual al total de ventas", () => {
  const t = base({ ventas_total: 630_730, contado_efectivo: 630_730, esperado_efectivo: 342_593, diferencia: 288_137, monto_inicial: FONDO, desglose_apertura: { "5000": 1 } });
  assert.ok(reglas(t).includes("contado_igual_ventas"));
});

test("gasto con 'Boleta N° retiro', gasto sin dígitos y gasto muy alto", () => {
  const g: Gasto[] = [
    { tipo: "Boleta", numero: "retiro", proveedor: "lorena v.", detalle: "frambueza", monto: 100_000, created_at: "2026-10-19T21:06:00Z" },
    { tipo: "Factura", numero: "", proveedor: "Mayorista", monto: 9_000, created_at: "2026-10-19T21:07:00Z" },
    { tipo: "Boleta", numero: "000866", proveedor: "lauriano suarez", detalle: "paltas 20 kilos", monto: 400_000, created_at: "2026-10-19T21:08:00Z" },
    { tipo: "Sin documento", numero: null, proveedor: "Feria", monto: 5_000, created_at: "2026-10-19T21:09:00Z" },
  ];
  const a = revisarTurno(base({ monto_inicial: FONDO, desglose_apertura: { "5000": 1 } }), g, { fondo: FONDO, retirosRecientes: [] });
  assert.equal(a.filter((x) => x.regla === "gasto_sin_documento").length, 2);
  assert.equal(a.filter((x) => x.regla === "gasto_grande").length, 1);
});

test("los gastos anulados no generan alertas", () => {
  const g: Gasto[] = [{ tipo: "Boleta", numero: "retiro", monto: 1_000_000, anulado: true, created_at: "2026-10-19T21:06:00Z" }];
  assert.deepEqual(reglas(base({ monto_inicial: FONDO, desglose_apertura: { "5000": 1 } }), g), []);
});

test("turno de 50 horas avisa como baja", () => {
  const t = base({ abierto_at: "2026-10-19T21:30:00Z", cerrado_at: "2026-10-21T15:00:00Z", monto_inicial: FONDO, desglose_apertura: { "5000": 1 } });
  const a = revisarTurno(t, [], { fondo: FONDO, retirosRecientes: [] });
  assert.equal(a.length, 1);
  assert.equal(a[0].regla, "turno_largo");
  assert.equal(a[0].gravedad, "baja");
});

test("16/10 08:55: cierre que cuadra no genera alertas", () => {
  const t = base({
    monto_inicial: 164_300, desglose_apertura: { "5000": 16, "1000": 80, "100": 24, "50": 38 }, ventas_total: 832_550, ventas_tarjeta: 636_450,
    esperado_efectivo: 434_550, contado_efectivo: 434_550, diferencia: 0, retiro_efectivo: 0,
    desglose_cierre: { tarjeta: 636_450, dif_tarjeta: 0, transferencia: 0, dif_transferencia: 0, efectivo: { "20000": 9, "10000": 16, "5000": 2, "2000": 31, "1000": 10, "500": 3, "100": 74, "50": 71, "10": 10 } },
    cerrado_at: "2026-10-21T18:00:00Z", abierto_at: "2026-10-21T10:00:00Z",
  });
  assert.deepEqual(reglas(t), []);
});

test("resumen para push: título con la cantidad y los títulos más graves", () => {
  const t = base({ ventas_total: 10_840, desglose_cierre: { tarjeta: 288_137 }, monto_inicial: FONDO, desglose_apertura: { "5000": 1 } });
  const p = resumenPush(revisarTurno(t, [], { fondo: FONDO, retirosRecientes: [] }));
  assert.match(p.titulo, /Revisión de caja: 1 alerta$/);
  assert.ok(p.cuerpo.length <= 180);
});

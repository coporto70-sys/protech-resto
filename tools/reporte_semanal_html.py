#!/usr/bin/env python3
"""Protech Resto · arma el correo HTML del reporte semanal de caja.

Uso:  python3 tools/reporte_semanal_html.py reporte.json > reporte.html
El JSON es el resultado de  select public.resto_reporte_semanal(local, desde, hasta)
(migración 040). Imprime el HTML listo para enviar por correo.
"""
import json, sys, html
from datetime import date

def m(v):
    v = int(v or 0)
    s = f"{abs(v):,}".replace(",", ".")
    return ("-$" if v < 0 else "$") + s

def dif(v):
    v = int(v or 0)
    if v == 0:
        return '<span style="color:#15803d">Cuadra</span>'
    return f'<b style="color:{"#b45309" if v > 0 else "#b91c1c"}">{"Sobra" if v > 0 else "Falta"} {m(abs(v))}</b>'

def fecha(s):
    d = date.fromisoformat(s)
    meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
    return f"{d.day} {meses[d.month - 1]}"

def e(x):
    return html.escape(str(x or ""))

def main():
    r = json.load(open(sys.argv[1]))
    if isinstance(r, list):
        r = r[0]
    if "r" in r:
        r = r["r"]
    t = r["totales"]
    local = (r.get("local") or "").title()
    th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #d6c3a1;font-size:12px;color:#6b4f2a"'
    td = 'style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top"'

    # Resumen
    filas_res = [
        ("Ventas de la semana", m(t["ventas"]) + f' <span style="color:#777">({t["cuentas"]} cuentas, {t["turnos"]} turnos)</span>'),
        ("Cobrado en efectivo", m(t["efectivo"])),
        ("Cobrado con tarjeta (incluye propinas)", m(t["tarjeta"])),
        ("Transferencias", m(t["transferencia"])),
        ("Propinas pagadas desde caja", m(t["propinas_pagadas"])),
        ("Gastos con boleta / factura", m(t["gastos"])),
        ("Retiros de efectivo", m(t["retiros"])),
    ]
    res = "".join(f'<tr><td {td}>{a}</td><td {td} align="right"><b>{b}</b></td></tr>' for a, b in filas_res)

    # Diferencias
    con_dif = [x for x in r["turnos"] if x["dif_efectivo"] or x["dif_tarjeta"] or x.get("recontado")]
    sob, fal, dt = t["sobrantes_efectivo"], t["faltantes_efectivo"], t["dif_tarjeta"]
    if con_dif:
        alerta = (f'<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:10px 12px;margin:8px 0">'
                  f'⚠️ <b>{t["turnos_con_diferencia"]} de {t["turnos"]} cierres no cuadraron.</b> '
                  f'Sobrante en efectivo {m(sob)} · faltante {m(abs(fal))} · diferencia en tarjetas {m(dt)}.'
                  + (' Cuando sobra plata, lo más común es una venta cobrada que no se registró en Resto.' if sob > abs(fal) else '')
                  + '</div>')
        filas = "".join(
            f'<tr><td {td}>{e(x["dia"])}<br><span style="color:#777">{e(x["turno"])}</span></td>'
            f'<td {td}>{e(x["cerro"])}</td>'
            f'<td {td}>{dif(x["dif_efectivo"])}'
            + (f'<br><span style="color:#b45309">recontó después de ver el cuadre (1er conteo {m(x["primer_conteo"])})</span>' if x.get("recontado") else '')
            + f'</td><td {td}>{dif(x["dif_tarjeta"]) if x["dif_tarjeta"] else "—"}</td>'
            f'<td {td[:-1]};color:#555">{e(x.get("nota")) or "—"}</td></tr>'
            for x in con_dif)
        tabla_dif = (f'<table cellspacing="0" style="width:100%;border-collapse:collapse"><tr><th {th}>Día</th><th {th}>Cerró</th>'
                     f'<th {th}>Efectivo</th><th {th}>Tarjetas</th><th {th}>Observación</th></tr>{filas}</table>')
    else:
        alerta = '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 12px;margin:8px 0">✅ <b>Todos los cierres de la semana cuadraron.</b></div>'
        tabla_dif = ""

    # Otros avisos
    avisos = []
    for a in r.get("aperturas_distintas") or []:
        avisos.append(f'{e(a["dia"])}: {e(a["abrio"])} abrió con {m(a["recibio"])}, pero el turno anterior dejó {m(a["dejo_el_anterior"])} ({dif(a["diferencia"])}).')
    for d in r.get("sin_cerrar_mas_de_16h") or []:
        avisos.append(f'{e(d)}: la caja quedó abierta más de 16 horas (no se cerró a tiempo).')
    avisos_html = ("<h3 style='color:#6b4f2a;margin:18px 0 6px'>Aperturas y cierres a revisar</h3><ul style='margin:0;padding-left:18px;font-size:13px'>"
                   + "".join(f"<li style='margin:4px 0'>{x}</li>" for x in avisos) + "</ul>") if avisos else ""

    # Garzones
    g_filas = "".join(
        f'<tr><td {td}>{e(g["garzon"])}</td><td {td} align="right">{g["cobros"]}</td><td {td} align="right">{m(g["ventas"])}</td>'
        f'<td {td} align="right">{g["anulaciones"]}{" (" + m(g["anul_monto"]) + ")" if g["anulaciones"] else ""}</td>'
        f'<td {td} align="right">{g["con_descuento"] or "—"}</td>'
        f'<td {td[:-1] + (";color:#b91c1c;font-weight:bold" if g["efectivo_a_otro"] else "")}" align="right">{g["pago_corregido"] or "—"}{" (" + str(g["efectivo_a_otro"]) + " de efectivo a otro)" if g["efectivo_a_otro"] else ""}</td></tr>'
        for g in r.get("por_garzon") or [])
    garz = (f"<h3 style='color:#6b4f2a;margin:18px 0 6px'>Por garzón</h3><table cellspacing='0' style='width:100%;border-collapse:collapse'>"
            f"<tr><th {th}>Garzón</th><th {th}>Cobros</th><th {th}>Vendido</th><th {th}>Anulaciones</th><th {th}>Descuentos</th><th {th}>Pago corregido</th></tr>{g_filas}</table>"
            "<p style='font-size:12px;color:#777;margin:4px 0 0'>Un pago cambiado de efectivo a tarjeta después de cobrar es la señal que más conviene revisar.</p>") if g_filas else ""

    gastos = r.get("gastos_mayores") or []
    gastos_html = ("<h3 style='color:#6b4f2a;margin:18px 0 6px'>Gastos más altos</h3><ul style='margin:0;padding-left:18px;font-size:13px'>"
                   + "".join(f"<li>{e(x['dia'])} · {m(x['monto'])} · {e(x['tipo'])}{' N° ' + e(x['numero']) if x.get('numero') else ''} · {e(x['detalle'])} ({e(x['por'])})</li>" for x in gastos)
                   + "</ul>") if gastos else ""

    print(f"""<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#222">
<div style="background:#4a3420;color:#f5d48b;padding:14px 16px;border-radius:10px 10px 0 0">
<div style="font-size:12px;letter-spacing:1px">PROTECH RESTO · REPORTE SEMANAL</div>
<div style="font-size:20px;font-weight:bold;color:#fff">{e(local)} · {fecha(r['desde'])} al {fecha(r['hasta'])}</div></div>
<div style="border:1px solid #e5d7bd;border-top:0;padding:14px 16px;border-radius:0 0 10px 10px">
<h3 style="color:#6b4f2a;margin:0 0 6px">Resumen</h3>
<table cellspacing="0" style="width:100%;border-collapse:collapse">{res}</table>
<h3 style="color:#6b4f2a;margin:18px 0 6px">Cuadre de caja</h3>{alerta}{tabla_dif}
{avisos_html}{garz}{gastos_html}
<p style="font-size:12px;color:#888;margin-top:18px">Reporte automático de Protech Resto. Dudas: Carlos Oporto, Ingeniero de Software · WhatsApp +56 9 3947 3588</p>
</div></div>""")

if __name__ == "__main__":
    main()

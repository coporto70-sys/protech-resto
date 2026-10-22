# Migraciones de Protech Resto

Se ejecutan **en orden numérico** en el editor SQL de Supabase (proyecto `micaja-pos`).
Todas son idempotentes (`if not exists`, `create or replace`) y solo agregan.

Las 001 a 014 **ya están aplicadas** en producción. Las nuevas se numeran siguiendo (015, 016, …).
Para saber cuál falta: la tabla `resto_migraciones` (desde la 015) lista las aplicadas.

- 017_operacion.sql: propina configurable, descuentos con autorización, opciones por producto, campo agotado.
- 018_insumos_avanzado.sql: recetas con descuento automático, proveedores, órdenes de compra, vencimientos.
- 019_propina_libre.sql: los garzones quitan o cambian la propina sin autorización (los descuentos siguen con autorización).
- 020_gastos_editar.sql: la administradora puede corregir el monto de un gasto de caja del turno abierto (motivo obligatorio, queda el monto original y el registro de cambios).
- 021_cuentas_metodo.sql: la administradora puede corregir la forma de pago de un cobro del turno abierto (p. ej. tarjeta → efectivo), con motivo obligatorio; queda el método original y el registro de cambios.
- 022_push.sql: avisos push a la administradora (anulación de producto, anulación de gasto, descuentos). Requiere publicar la función Edge resto-push (supabase/functions/resto-push) con la verificación de JWT desactivada.
- 023_propina_caja.sql: la propina en efectivo puede quedar en la caja (del vuelto) y se paga al cerrar, o ir directo al garzón; el informe de Garzones separa tarjeta, efectivo en caja y directo en mano.
- 024_whatsapp.sql: agente de WhatsApp que responde con Claude y pasa a una persona (tablas resto_wa_config, resto_wa_chats, resto_wa_msgs). Requiere publicar la función Edge resto-whatsapp sin verificación de JWT y el secreto ANTHROPIC_API_KEY.
- 025_cierre_con_corte.sql: la administradora puede cerrar la caja solo hasta el final de un día pasado (ej. cerrar ayer cuando el turno quedó abierto y hoy ya hay ventas). Cierra el turno en el corte, abre uno nuevo con el sencillo que quedó y traslada lo posterior (cobros, gastos, retiros). Función resto_cerrar_turno_corte.
- 026_control_caja.sql: control de caja. Al cerrar un turno revisa posibles errores de ingreso (tarjetas que no cuadran, apertura sin sencillo, retiro repetido, etc.), guarda las alertas (resto_control_alertas) y avisa por push a la administradora; solo lee y avisa. Requiere publicar la función Edge resto-control-caja sin verificación de JWT (el secreto ANTHROPIC_API_KEY es opcional) y haber ejecutado la 022.

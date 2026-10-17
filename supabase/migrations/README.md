# Migraciones de Protech Resto

Se ejecutan **en orden numérico** en el editor SQL de Supabase (proyecto `micaja-pos`).
Todas son idempotentes (`if not exists`, `create or replace`) y solo agregan.

Las 001 a 014 **ya están aplicadas** en producción. Las nuevas se numeran siguiendo (015, 016, …).
Para saber cuál falta: la tabla `resto_migraciones` (desde la 015) lista las aplicadas.

- 017_operacion.sql: propina configurable, descuentos con autorización, opciones por producto, campo agotado.
- 018_insumos_avanzado.sql: recetas con descuento automático, proveedores, órdenes de compra, vencimientos.

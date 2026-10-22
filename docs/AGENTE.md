# Agente de operaciones de Protech Resto (WhatsApp)

Un agente con IA (Claude) que trabaja para ti y para las administradoras por WhatsApp:

- **Responde preguntas con datos reales**: "¿cómo va la caja?", "¿cuánto se vendió ayer?", "¿por qué no cuadró el cierre del 19?", "¿qué cambió hoy y quién lo cambió?".
- **Vigila el sistema cada 10 minutos** y avisa solo cuando hay algo que revisar (caja sin cerrar, anulaciones sin responder, intentos fallidos de clave, alertas de caja sin ver, y fallas del propio control de caja). No repite el mismo aviso.
- **Avisa cada apertura y cada cierre de caja**, con quién la abrió o cerró, el sencillo, las ventas, la diferencia y el resultado del control de caja. Llega por WhatsApp y por push.
- **Guarda propuestas de mejora** cuando alguien sugiere un cambio. Tú decides cuáles se hacen.

**Es de solo lectura**: no abre ni cierra caja, no anula, no corrige, no aprueba descuentos y no mueve dinero. Si se lo piden, explica en qué pestaña de Resto se hace.

Es el mismo número y la misma función `resto-whatsapp` del agente de clientes (ver `WHATSAPP.md`): si escribe alguien registrado en el equipo lo atiende este agente; si escribe cualquier otra persona, el agente de clientes.

## 1. Meta (lo haces tú, una vez)
Sigue los pasos 1 a 4 de `WHATSAPP.md` con el **número nuevo** del agente (no puede estar en la app normal de WhatsApp). Es obligatorio cargar el `app_secret`: sin él, el agente ignora al equipo, porque no puede comprobar que el mensaje viene de Meta.

### Plantilla de aviso (para que el agente pueda escribirte primero)
WhatsApp solo deja escribir libremente dentro de las 24 horas siguientes al último mensaje de la persona. Pasado ese tiempo, solo se puede enviar una **plantilla aprobada por Meta**. Para que los avisos lleguen siempre:

1. En WhatsApp Manager → Plantillas de mensajes → Crear plantilla.
2. Categoría **Utilidad**, nombre `aviso_resto`, idioma **Español**.
3. Cuerpo: `Aviso de Protech Resto: {{1}}`
4. Espera la aprobación (suele tardar minutos u horas).

Mientras no exista, los avisos llegan solo si escribiste al agente en las últimas 24 horas. Una buena costumbre: saludarlo al empezar el día. Los avisos push siguen funcionando igual.

## 2. Base de datos y función
1. Ejecutar `supabase/migrations/029_agente_operaciones.sql` (requiere haber ejecutado la 022, 024 y 026).
2. Activar la extensión **pg_cron** (Supabase → Database → Extensions) y, si estaba apagada, volver a ejecutar el último bloque de la 029 para programar el vigía.
3. Publicar de nuevo la función `supabase/functions/resto-whatsapp` (ahora son varios archivos) con **Verify JWT desactivado**.
4. Secretos: `ANTHROPIC_API_KEY` (el mismo de las otras funciones). Opcional: `AGENTE_MODELO` para cambiar el modelo (por defecto `claude-sonnet-5-5`).
5. Cargar la plantilla en la configuración del local:

```sql
update public.resto_wa_config set plantilla_aviso = 'aviso_resto' where local_id = '<ID DEL LOCAL>';
```

## 3. Registrar al equipo
Solo los números que estén aquí son atendidos como equipo. Usa solo dígitos con código de país.

```sql
-- Tú: ven todos los locales y el estado técnico. avisos 'todo' = recibes cada apertura y cierre.
insert into public.resto_wa_equipo (telefono, nombre, rol, avisos)
values ('569XXXXXXXX', 'Carlos Oporto', 'ingeniero', 'todo');

-- Administradora de Super Pastel: solo ve su local. avisos 'importantes' = solo alertas.
insert into public.resto_wa_equipo (local_id, telefono, nombre, rol, avisos)
values ('<ID DEL LOCAL>', '569XXXXXXXX', 'Administradora', 'admin', 'importantes');
```

`avisos` puede ser `todo` (cada apertura y cierre, más alertas), `importantes` (solo alertas) o `nada` (solo responde cuando le escribes). Para sacar a alguien: `update public.resto_wa_equipo set activo = false where telefono = '569XXXXXXXX';`

El control de caja debe estar activo en el local (`resto_locales.control_caja = true`, ya lo está en Super Pastel). Sin eso, no hay avisos de apertura ni de cierre.

## 4. Probar
1. Escríbele "hola" desde tu WhatsApp al número del agente. Debe responderte con tu nombre.
2. Pregunta "¿cómo va la caja?" y "¿qué solicitudes están pendientes?".
3. Abre una caja de prueba en Resto: deben llegarte el aviso de apertura por WhatsApp y el push.
4. Para ver qué vigiló, pídele "estado del sistema".

Si no responde: revisa que tu número esté en `resto_wa_equipo` con `activo = true`, que `app_secret` esté cargado y los registros de la función en Supabase.

## 5. Qué ve cada rol
| | Ingeniero | Administradora |
|---|---|---|
| Caja, ventas, cierres, alertas, pendientes, actividad, mesas | todos los locales | solo su local |
| Estado del sistema (migraciones, vigía) | sí | solo lo de su local |
| Guardar propuestas | sí | sí |
| Aprobar o rechazar propuestas | sí | no |

## 6. Seguridad
- Solo atiende a números del equipo y solo si el mensaje viene firmado por Meta.
- Todas las consultas son de lectura y se limitan al local de la persona; nunca devuelve claves, PIN ni tokens.
- Los textos que vienen de los datos del local (nombres de productos, motivos, notas) se tratan como datos, no como instrucciones.
- Límite de 60 mensajes por persona y hora. Las conversaciones y los avisos se borran a los 90 días.
- Las acciones internas (`vigia`, `evento_turno`) exigen la clave interna del sistema; Meta u otra persona no pueden dispararlas.

## 7. Pruebas
```
node --test supabase/functions/resto-control-caja/reglas.test.ts
node --test supabase/functions/resto-whatsapp/agente.test.ts
node --import ./supabase/functions/resto-whatsapp/pruebas/registrar.mjs --test supabase/functions/resto-whatsapp/herramientas.test.ts
```
Las dos últimas cubren la hora de Chile, las reglas del vigía, el alcance por rol y el flujo completo del agente con una base de datos y una IA simuladas.

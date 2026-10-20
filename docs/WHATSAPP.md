# Agente de WhatsApp de Protech Resto

El agente responde a los clientes con Claude usando la carta y los datos del local. Si no sabe, o el cliente quiere reservar, pedir o reclamar, pasa la conversación a una persona: deja de responder, avisa por notificación push (y, si quieres, por WhatsApp) y deja el motivo.

## 1. Meta (lo haces tú, una vez)
1. https://developers.facebook.com → Mis apps → Crear app → tipo **Negocio** → agrega el producto **WhatsApp**.
2. En WhatsApp → Configuración de la API: registra el número del local (no puede estar en la app normal de WhatsApp) o usa el de prueba.
3. Anota: **Identificador de número de teléfono** (phone_number_id) y crea un **token permanente** (Usuario del sistema en Business Manager con permiso `whatsapp_business_messaging`).
4. Configuración de la app → Básica → **Clave secreta de la app** (app_secret).

## 2. Base de datos y función
1. Ejecutar `supabase/migrations/024_whatsapp.sql`.
2. Publicar la función `supabase/functions/resto-whatsapp` con **Verify JWT desactivado**. El secreto `ANTHROPIC_API_KEY` es el mismo del asistente de ayuda.
3. Cargar la configuración del local (ejemplo, cambia los valores):

```sql
insert into public.resto_wa_config (local_id, phone_number_id, token, verify_token, app_secret, info, tono, aviso_a)
values (
  '<ID DEL LOCAL>', '<phone_number_id>', '<token permanente>', 'una-frase-secreta-que-tu-elijas', '<app_secret>',
  'Horario: lunes a sábado 9:00 a 20:00. Dirección: ... Medios de pago: ... Reservas: ... Delivery: ...',
  'Cercano y breve', '569XXXXXXXX'
);
```

## 3. Conectar el webhook en Meta
WhatsApp → Configuración → Webhook:
- URL de devolución: `https://fchqqtdapyrgpkyxiful.supabase.co/functions/v1/resto-whatsapp`
- Token de verificación: el mismo `verify_token` de arriba.
- Suscribirse al campo **messages**.

## 4. Uso diario
- Cuando una persona toma la conversación, el agente ya no contesta ese número. Para devolverla al agente:
  `update public.resto_wa_chats set modo='bot' where local_id='<ID>' and telefono='569XXXXXXXX';`
- El historial queda en `resto_wa_msgs`.
- Límite: 20 respuestas del agente por cliente y hora.
- Meta solo permite responder libremente dentro de las 24 h posteriores al último mensaje del cliente.

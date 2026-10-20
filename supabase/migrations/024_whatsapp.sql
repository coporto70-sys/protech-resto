-- Protech Resto · 024 · Agente de WhatsApp (responde con Claude y pasa a una persona cuando hace falta)
-- Requiere publicar la función Edge `resto-whatsapp` (carpeta supabase/functions/resto-whatsapp), SIN verificación de JWT,
-- y el secreto ANTHROPIC_API_KEY (el mismo del asistente de ayuda).
-- Solo AGREGA tablas. Es seguro ejecutarlo más de una vez. Ninguna tabla tiene políticas: solo la función (service role) las lee.

-- Una fila por local con WhatsApp: número de Meta, claves y datos que el agente puede decir
create table if not exists public.resto_wa_config (
  local_id uuid primary key,
  phone_number_id text not null unique,   -- "Identificador de número de teléfono" de WhatsApp Cloud API (Meta)
  token text not null,                    -- token de acceso permanente de Meta
  verify_token text not null,             -- texto que tú eliges y pegas también en Meta al configurar el webhook
  app_secret text,                        -- "Secreto de la app" de Meta: sirve para comprobar que el mensaje viene de Meta
  activo boolean not null default true,
  info text not null default '',          -- horarios, dirección, medios de pago, reservas, delivery, etc. (texto libre)
  tono text not null default '',          -- opcional: cómo quieres que hable
  aviso_a text,                           -- opcional: número (con 56...) al que se le avisa por WhatsApp cuando alguien pide una persona
  created_at timestamptz not null default now()
);
alter table public.resto_wa_config enable row level security;

-- Conversaciones: 'bot' responde solo; 'humano' = una persona la atiende y el agente se calla
create table if not exists public.resto_wa_chats (
  local_id uuid not null,
  telefono text not null,
  nombre text,
  modo text not null default 'bot' check (modo in ('bot', 'humano')),
  motivo text,
  actualizado timestamptz not null default now(),
  primary key (local_id, telefono)
);
alter table public.resto_wa_chats enable row level security;

create table if not exists public.resto_wa_msgs (
  id bigserial primary key,
  local_id uuid not null,
  telefono text not null,
  autor text not null check (autor in ('cliente', 'bot', 'humano')),
  texto text not null,
  wa_id text unique,                      -- evita responder dos veces si Meta reenvía el mismo mensaje
  created_at timestamptz not null default now()
);
create index if not exists resto_wa_msgs_chat on public.resto_wa_msgs (local_id, telefono, created_at desc);
alter table public.resto_wa_msgs enable row level security;

insert into public.resto_migraciones (nombre) values ('024_whatsapp') on conflict do nothing;

// Entorno de prueba: simula Deno y supabase-js (base en memoria) para ejecutar las funciones con `node --test`, sin red ni base real.
// Uso:  node --import ./supabase/functions/resto-whatsapp/pruebas/registrar.mjs --test supabase/functions/resto-whatsapp/herramientas.test.ts
import { register } from "node:module";
globalThis.__ENV = { SUPABASE_URL: "http://fake", SUPABASE_SERVICE_ROLE_KEY: "fake", ANTHROPIC_API_KEY: "clave-de-prueba" };
globalThis.Deno = { env: { get: (k) => globalThis.__ENV[k] }, serve: () => {} };
globalThis.__TABLAS = {};
register("./gancho.mjs", import.meta.url);

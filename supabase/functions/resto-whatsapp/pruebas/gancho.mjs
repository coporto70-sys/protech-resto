// Redirige "npm:@supabase/supabase-js@2" a la base falsa.
export async function resolve(especificador, contexto, siguiente) {
  if (especificador.startsWith("npm:@supabase/supabase-js")) return { url: new URL("./base-falsa.mjs", import.meta.url).href, shortCircuit: true };
  return siguiente(especificador, contexto);
}

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  error: "El importador de datos heredado fue retirado. Todos los registros nuevos deben usar relaciones canónicas de Supabase.",
}), {
  status: 410,
  headers: { "content-type": "application/json; charset=utf-8" },
}));

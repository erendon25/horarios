import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  error: "El importador de autenticación heredado fue retirado. Las cuentas se administran únicamente con Supabase Auth.",
}), {
  status: 410,
  headers: { "content-type": "application/json; charset=utf-8" },
}));

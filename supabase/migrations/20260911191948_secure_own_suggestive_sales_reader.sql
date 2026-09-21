alter function public.get_my_suggestive_sales_goals(date) security invoker;

comment on function public.get_my_suggestive_sales_goals(date) is
  'Devuelve únicamente las metas del perfil autenticado y respeta RLS con SECURITY INVOKER.';

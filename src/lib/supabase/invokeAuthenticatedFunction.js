const pendingRefresh = new WeakMap();

const sessionFailure = () => ({
  data: null,
  error: Object.assign(new Error('Inicia sesión nuevamente para continuar.'), {
    context: new Response(JSON.stringify({ error: 'invalid_session' }), { status: 401 }),
  }),
});

// Always use the current user session, and retry an authentication rejection once.
// A 401 is returned before staff-account-admin performs any account mutations.
export async function invokeAuthenticatedFunction(client, name, options = {}) {
  const initial = await client.auth.getSession();
  const session = initial.data?.session;
  if (initial.error || !session?.access_token) return sessionFailure();
  const invoke = (token) => client.functions.invoke(name, {
    ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  const result = await invoke(session.access_token);
  if (result.error?.context?.status !== 401) return result;

  const latest = await client.auth.getSession();
  if (latest.error || !latest.data?.session || latest.data.session.user.id !== session.user.id) return sessionFailure();
  if (latest.data.session.access_token !== session.access_token) return invoke(latest.data.session.access_token);

  let refresh = pendingRefresh.get(client);
  if (!refresh) {
    refresh = client.auth.refreshSession().finally(() => pendingRefresh.delete(client));
    pendingRefresh.set(client, refresh);
  }
  const renewed = await refresh;
  if (renewed.error || !renewed.data?.session?.access_token || renewed.data.session.user.id !== session.user.id) return sessionFailure();
  return invoke(renewed.data.session.access_token);
}

(function () {
  const routeBase = window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/') + 1);
  const client = window.supabase.createClient(
    window.supabasePortalConfig.url,
    window.supabasePortalConfig.publishableKey,
    { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } }
  );
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !window.location.pathname.endsWith('/login.html')) {
      window.location.replace(`${routeBase}login.html`);
    }
  });

  async function requireRole(role) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      window.location.replace(`${routeBase}login.html`);
      return null;
    }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, project_id')
      .eq('id', sessionData.session.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.role !== role || (role === 'client' && !profile.project_id)) {
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw signOutError;
      window.location.replace(`${routeBase}login.html`);
      return null;
    }
    return { client, user: sessionData.session.user, profile };
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    window.location.replace(`${routeBase}login.html`);
  }

  function safeFileName(name) {
    return name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100) || 'file';
  }

  window.portalAuth = { client, requireRole, signOut, safeFileName };
})();

import { DOMAIN_STATE_PREFIX } from "../app/shared/domain-auth.ts";
export function configuration(env) {
  if (!env?.LAKEBED_ORIGIN || !env?.CUSTOM_DOMAIN_ORIGIN) throw new Error("Domain proxy is not configured.");
  const upstream=new URL(env.LAKEBED_ORIGIN), domain=new URL(env.CUSTOM_DOMAIN_ORIGIN);
  if ([upstream,domain].some(url=>url.protocol!=="https:"||url.pathname!=="/"||url.search||url.hash||url.username||url.password)) throw new Error("Invalid proxy origin configuration.");
  return {UPSTREAM:upstream.origin,PUBLIC_ORIGIN:domain.origin,PUBLIC_HOST:domain.hostname};
}
const AUTH_BROKER = "https://auth.lakebed.dev";

export function brokerParameters(parameters, env) {
  const {UPSTREAM,PUBLIC_ORIGIN}=configuration(env);
  const BROKER_CALLBACK=UPSTREAM+"/auth/callback";
  const params = new URLSearchParams(parameters);
  if (params.get("client_id") !== "origin:" + PUBLIC_ORIGIN || params.get("redirect_uri") !== PUBLIC_ORIGIN + "/auth/callback") throw new Error("Invalid sign-in client or callback");
  params.set("client_id", "origin:" + UPSTREAM);
  params.set("redirect_uri", BROKER_CALLBACK);
  if (params.has("state")) params.set("state", DOMAIN_STATE_PREFIX + params.get("state"));
  return params;
}

export function proxyAuthConfig(html, env) {
  const {PUBLIC_ORIGIN}=configuration(env);
  return html.replace('"authBaseUrl":"' + AUTH_BROKER + '"', '"authBaseUrl":"' + PUBLIC_ORIGIN + '"');
}

export function upstreamRequest(request, env) {
  const {UPSTREAM,PUBLIC_HOST}=configuration(env);
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, UPSTREAM);
  const headers = new Headers(request.headers);
  headers.delete("host");
  // Keep Lakebed's same-origin protections working at its canonical upstream.
  // Only translate this app's origin; unrelated cross-origin callers stay unrelated.
  if (headers.get("origin") === incoming.origin) headers.set("origin", UPSTREAM);
  const referer = headers.get("referer");
  if (referer) {
    const parsed = new URL(referer);
    if (parsed.origin === incoming.origin) headers.set("referer", UPSTREAM + parsed.pathname + parsed.search);
  }
  headers.set("x-forwarded-host", PUBLIC_HOST);
  headers.set("x-forwarded-proto", "https");
  return new Request(target, new Request(request, { headers, redirect: "manual" }));
}

export default {
  async fetch(request, env) {
    let config;
    try { config=configuration(env); } catch { return new Response("Domain proxy is not configured",{status:503}); }
    const {UPSTREAM,PUBLIC_ORIGIN,PUBLIC_HOST}=config;
    const incoming = new URL(request.url);
    // Keep the native broker, PKCE and signed token verification intact. Only
    // translate the fixed client/callback pair at the proxy boundary.
    if (incoming.pathname === "/authorize" || incoming.pathname === "/token") {
      const expectedMethod = incoming.pathname === "/authorize" ? "GET" : "POST";
      if (request.method !== expectedMethod) return new Response("Method not allowed", { status: 405 });
      const origin = request.headers.get("origin");
      if (origin && origin !== PUBLIC_ORIGIN) return new Response("Origin not allowed", { status: 403 });
      try {
        const params = brokerParameters(incoming.pathname === "/authorize" ? incoming.searchParams : await request.text(), env);
        if (incoming.pathname === "/authorize") {
          // Navigate to the real broker so its own Google callback cookies stay
          // on auth.lakebed.dev, rather than being set on the proxy hostname.
          const target = new URL("/authorize", AUTH_BROKER);
          target.search = params.toString();
          return Response.redirect(target, 302);
        }
        if (params.get("grant_type") !== "authorization_code") return new Response("Invalid grant type", { status: 400 });
        return fetch(AUTH_BROKER + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: UPSTREAM }, body: params.toString(), redirect: "manual" });
      } catch { return new Response("Invalid sign-in request", { status: 400 }); }
    }
    const response = await fetch(upstreamRequest(request,env));
    // Return an upgrade unchanged: Cloudflare passes the live WebSocket through.
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    const location = headers.get("location");
    if (location) {
      const redirected = new URL(location, UPSTREAM);
      if (redirected.origin === UPSTREAM) headers.set("location", "https://" + PUBLIC_HOST + redirected.pathname + redirected.search + redirected.hash);
    }
    // Never cache session setup, private data or app entry pages at the proxy.
    const path = incoming.pathname;
    if (path.startsWith("/__lakebed/") || path === "/" || path.startsWith("/auth/")) headers.set("cache-control", "private, no-store");
    if (headers.get("content-type")?.includes("text/html")) {
      const html = proxyAuthConfig(await response.text(),env);
      headers.delete("content-length");
      headers.delete("content-encoding");
      headers.delete("etag");
      return new Response(html, { status: response.status, statusText: response.statusText, headers });
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};

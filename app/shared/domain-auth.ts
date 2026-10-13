export const DOMAIN_STATE_PREFIX = "dangler_domain_";

// Only tagged sign-ins started at our custom hostname return there. Ordinary
// Lakebed-origin sign-ins keep their existing callback and browser storage.
export type DomainConfig = { lakebedOrigin: string; domainOrigin: string };
export function domainCallbackUrl(input: string, config: DomainConfig): string | null {
  if (!config.lakebedOrigin || !config.domainOrigin) return null;
  const incoming = new URL(input);
  if (incoming.origin !== config.lakebedOrigin || incoming.pathname !== "/auth/callback") return null;
  const state = incoming.searchParams.get("state");
  if (!state?.startsWith(DOMAIN_STATE_PREFIX)) return null;
  const originalState = state.slice(DOMAIN_STATE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(originalState)) return null;
  const target = new URL("/auth/callback", config.domainOrigin);
  target.searchParams.set("state", originalState);
  for (const key of ["code", "error", "error_description", "error_uri"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return target.toString();
}

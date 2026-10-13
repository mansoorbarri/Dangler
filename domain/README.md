# Optional custom-domain proxy

This Cloudflare Worker forwards HTTP and live WebSocket requests to a Lakebed app. The app, private database records and external source fetching stay on Lakebed. Cloudflare manages the hostname and TLS certificate.

Configure the Lakebed origin, custom-domain origin and Cloudflare account ID in the project root's ignored `.env.local`, then generate local deployment settings:

```bash
node scripts/configure.mjs
npx wrangler login
npx wrangler deploy --config domain/wrangler.local.jsonc
```

The committed `wrangler.jsonc` is a neutral template. The generated local configuration contains the actual routing/account values and is ignored. Do not deploy the template directly: it has no domain binding or runtime origins.

## Sign-in adapter

Lakebed tokens are bound to the canonical app origin. The proxy translates only the fixed client/callback pair while preserving the native broker, PKCE verifier and signed token validation:

1. The proxied HTML configures the SDK to begin sign-in at the custom domain.
2. `/authorize` redirects to the real auth broker with the canonical client, its registered callback and a tagged state. Broker/Google cookies remain on their own domain.
3. An early bootstrap in the Lakebed client recognises tagged callbacks at the canonical origin and returns their one-time code to the fixed custom hostname, restoring the original state. Untagged original-host sign-ins are unchanged.
4. `/token` translates the fixed client/callback pair before the real broker exchanges the one-time code using the private PKCE verifier. The proxy never signs, decodes or fabricates tokens, and does not send app cookies or identity headers to the broker.
5. Lakebed's normal session upgrade verifies the canonical token and retains the existing account ID and records.

Guest sessions and browser storage are separate between hostnames. Sign-in upgrades a new guest through Lakebed's normal account flow. The proxy rejects unrelated origins on broker POSTs, does not cache session/data pages and passes WebSocket upgrades through unchanged. Both configured origins must be valid HTTPS origins without paths or credentials.

## Verification

```bash
node --test tests/domain.test.mjs
```

Tests use example domains only and cover request forwarding, unrelated origins, redirect rewriting, no-store responses, WebSockets, PKCE translation and tagged callback handling. Verify HTTPS, guest access, a live dashboard connection and interactive Google login after deploying to your own hostname.

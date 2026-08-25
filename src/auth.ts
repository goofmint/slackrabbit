/**
 * Constant-time string comparison (equivalent of Go's
 * `subtle.ConstantTimeCompare`). Length mismatch returns early because the
 * length itself is not secret.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/**
 * Validates `Authorization: Bearer <MCP_API_KEY>`.
 *
 * - The `Bearer` scheme is required (matched case-insensitively per RFC 7235);
 *   a bare key without the scheme is rejected.
 * - When MCP_API_KEY is unset the check is skipped (mirrors the upstream Go
 *   server; intended for local development only). wrangler.jsonc lists
 *   MCP_API_KEY under `secrets.required` so `wrangler dev` warns when it is
 *   missing; always set it for deployed environments.
 */
export function checkBearer(request: Request, key: string | undefined): boolean {
  if (!key) return true;
  const header = request.headers.get('Authorization') ?? '';
  const prefix = 'bearer ';
  if (!header.slice(0, prefix.length).toLowerCase().startsWith(prefix)) return false;
  return timingSafeEqual(header.slice(prefix.length), key);
}

import { timingSafeEqual } from 'crypto';
import { isIP } from 'net';

export const PROXY_KEY_HEADER = 'x-fatrina-proxy-key';
export const CLIENT_IP_HEADER = 'x-fatrina-client-ip';

const header = (req: { headers?: Record<string, unknown> }, name: string) => {
  const v = req.headers?.[name];
  return typeof (Array.isArray(v) ? v[0] : v) === 'string' ? ((Array.isArray(v) ? v[0] : v) as string) : undefined;
};

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The visitor's IP for rate limits and session metadata. The website's server-side proxy (one IP
 * for every web visitor) forwards the real visitor IP with a shared secret; any other request
 * keeps `req.ip` (Vercel's proxy, `trust proxy` = 1).
 */
export function clientIp(
  req: { ip?: string; headers?: Record<string, unknown> },
  secret: string | undefined = process.env.WEB_PROXY_SECRET,
): string | undefined {
  if (secret && secret.length >= 24) {
    const key = header(req, PROXY_KEY_HEADER);
    const forwarded = header(req, CLIENT_IP_HEADER)?.trim();
    if (key && forwarded && sameSecret(key, secret) && isIP(forwarded)) return forwarded;
  }
  return req.ip;
}

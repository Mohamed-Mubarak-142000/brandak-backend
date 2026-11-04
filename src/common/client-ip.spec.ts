import { ClientThrottlerGuard } from './guards/client-throttler.guard';
import { clientIp } from './client-ip';

const SECRET = 'a-very-long-proxy-secret-1234567890';
const req = (headers: Record<string, string> = {}) => ({ ip: '10.0.0.1', headers });

describe('clientIp (website proxy)', () => {
  it('uses the forwarded IP only with the right secret', () => {
    expect(clientIp(req({ 'x-fatrina-proxy-key': SECRET, 'x-fatrina-client-ip': '41.33.12.7' }), SECRET)).toBe('41.33.12.7');
    expect(clientIp(req({ 'x-fatrina-proxy-key': SECRET, 'x-fatrina-client-ip': '2001:db8::1' }), SECRET)).toBe('2001:db8::1');
    expect(clientIp(req({ 'x-fatrina-proxy-key': 'wrong-secret-wrong-secret-wrong', 'x-fatrina-client-ip': '41.33.12.7' }), SECRET)).toBe('10.0.0.1');
    expect(clientIp(req({ 'x-fatrina-proxy-key': SECRET.slice(0, -1), 'x-fatrina-client-ip': '41.33.12.7' }), SECRET)).toBe('10.0.0.1');
    expect(clientIp(req({ 'x-fatrina-client-ip': '41.33.12.7' }), SECRET)).toBe('10.0.0.1');
  });

  it('ignores an invalid forwarded IP and works unchanged without a configured secret', () => {
    expect(clientIp(req({ 'x-fatrina-proxy-key': SECRET, 'x-fatrina-client-ip': 'not-an-ip' }), SECRET)).toBe('10.0.0.1');
    expect(clientIp(req({ 'x-fatrina-proxy-key': SECRET, 'x-fatrina-client-ip': '41.33.12.7' }), undefined)).toBe('10.0.0.1');
    expect(clientIp(req({ 'x-fatrina-proxy-key': 'short', 'x-fatrina-client-ip': '41.33.12.7' }), 'short')).toBe('10.0.0.1');
  });

  it('the throttler tracks web visitors separately only with the right secret', async () => {
    const before = process.env.WEB_PROXY_SECRET;
    process.env.WEB_PROXY_SECRET = SECRET;
    try {
      const guard = new ClientThrottlerGuard({ throttlers: [] } as never, {} as never, {} as never) as unknown as {
        getTracker(r: unknown): Promise<string>;
      };
      expect(await guard.getTracker(req({ 'x-fatrina-proxy-key': SECRET, 'x-fatrina-client-ip': '41.33.12.7' }))).toBe('41.33.12.7');
      expect(await guard.getTracker(req({ 'x-fatrina-proxy-key': 'nope', 'x-fatrina-client-ip': '41.33.12.7' }))).toBe('10.0.0.1');
    } finally {
      if (before === undefined) delete process.env.WEB_PROXY_SECRET;
      else process.env.WEB_PROXY_SECRET = before;
    }
  });
});

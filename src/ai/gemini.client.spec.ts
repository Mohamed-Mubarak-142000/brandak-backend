import { GeminiCandidate, GeminiClient, GenerateRequest } from './gemini.client';

const config = { get: (k: string) => ({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-flash-latest' })[k] } as never;
const call = (name: string, args: Record<string, unknown> = {}): GeminiCandidate => ({ content: { role: 'model', parts: [{ functionCall: { name, args } }] } });
const text = (t: string): GeminiCandidate => ({ content: { role: 'model', parts: [{ text: t }] } });

describe('GeminiClient.runWithTools', () => {
  it('runs requested tools, sends results back and returns the final text', async () => {
    const client = new GeminiClient(config);
    const seen: GenerateRequest[] = [];
    const answers: GeminiCandidate[] = [
      call('lookup', { q: 'x' }),
      { content: { parts: [{ functionCall: { name: 'nope' } }, { functionCall: { name: 'lookup', args: { q: 'y' } } }] } },
      text('تمام'),
    ];
    jest.spyOn(client, 'generate').mockImplementation(async (req) => {
      seen.push(JSON.parse(JSON.stringify(req)));
      return { candidate: answers.shift(), model: 'm' };
    });
    const handler = jest.fn(async (args: Record<string, unknown>) => ({ found: args.q }));
    const res = await client.runWithTools({
      system: 'sys',
      history: [
        { role: 'model', text: 'dropped: before the first user turn' },
        { role: 'user', text: 'قبل كده' },
        { role: 'model', text: 'رد' },
      ],
      userText: 'سؤال',
      tools: [{ declaration: { name: 'lookup', description: 'd' }, handler }],
    });
    expect(res.text).toBe('تمام');
    expect(res.rounds).toBe(3);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(res.calls.map((c) => [c.name, c.result])).toEqual([
      ['lookup', { found: 'x' }],
      ['nope', { error: 'UNKNOWN_TOOL', message: 'No tool named nope' }],
      ['lookup', { found: 'y' }],
    ]);
    expect(seen[0].contents[0]).toEqual({ role: 'user', parts: [{ text: 'قبل كده' }] });
    expect(seen[0].systemInstruction).toBe('sys');
    expect(seen[2].contents.at(-1)!.parts.map((p) => p.functionResponse?.name)).toEqual(['nope', 'lookup']);
    expect(seen[2].preferModel).toBe('m');
  });

  it('a failing tool becomes an error result, and the last round must answer without tools', async () => {
    const client = new GeminiClient(config);
    const seen: GenerateRequest[] = [];
    jest.spyOn(client, 'generate').mockImplementation(async (req) => {
      seen.push(req);
      return { candidate: seen.length < 2 ? call('boom') : text('خلاص'), model: 'm' };
    });
    const res = await client.runWithTools({
      system: 's',
      history: [],
      userText: 'u',
      maxRounds: 2,
      tools: [
        {
          declaration: { name: 'boom', description: 'd' },
          handler: async () => {
            throw new Error('db down');
          },
        },
      ],
    });
    expect(res.calls[0].result).toEqual({ error: 'TOOL_FAILED' });
    expect(seen[0].toolConfig).toBeUndefined();
    expect(seen[1].toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    expect(res.text).toBe('خلاص');
  });

  it('keeps text the model wrote next to a tool call', async () => {
    const client = new GeminiClient(config);
    const answers: GeminiCandidate[] = [
      { content: { parts: [{ text: 'عندنا طقم بـ 350 ج.م.' }, { functionCall: { name: 'show', args: {} } }] } },
      text('تقدر تطلبه من الموقع.'),
    ];
    jest.spyOn(client, 'generate').mockImplementation(async () => ({ candidate: answers.shift(), model: 'm' }));
    const res = await client.runWithTools({ system: 's', history: [], userText: 'u', tools: [{ declaration: { name: 'show', description: 'd' }, handler: () => ({ ok: true }) }] });
    expect(res.text).toBe('عندنا طقم بـ 350 ج.م.\nتقدر تطلبه من الموقع.');
  });

  it('is disabled without a key', async () => {
    const off = new GeminiClient({ get: () => undefined } as never);
    expect(off.enabled).toBe(false);
    await expect(off.generate({ contents: [] })).rejects.toMatchObject({ reason: 'DISABLED' });
  });
});

describe('GeminiClient.generate hedging', () => {
  const ok = (model: string) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ candidates: [text(model)] }) });
  const fail = (status: number) => ({ ok: false, status, text: async () => 'x', json: async () => ({}) });
  const delay = <T>(ms: number, v: T, signal?: AbortSignal) =>
    new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve(v), ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve(fail(504) as T);
      });
    });

  afterEach(() => jest.restoreAllMocks());

  it('asks the next model when the first is silent, and the first good answer wins', async () => {
    const client = new GeminiClient(config);
    const asked: string[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      const model = String(url).match(/models\/([^:]+):/)![1];
      asked.push(model);
      return (asked.length === 1 ? delay(2_000, ok(model), init?.signal ?? undefined) : delay(20, ok(model))) as never;
    });
    const t = Date.now();
    const res = await client.generate({ contents: [{ role: 'user', parts: [{ text: 'q' }] }], hedgeAfterMs: 50, timeoutMs: 5_000 });
    expect(asked).toHaveLength(2);
    expect(res.model).toBe(asked[1]);
    expect(Date.now() - t).toBeLessThan(1_000);
  });

  it('replaces a busy model right away and reports busy when every model fails', async () => {
    const client = new GeminiClient(config);
    let n = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      n++;
      return fail(503) as never;
    });
    await expect(client.generate({ contents: [{ role: 'user', parts: [{ text: 'q' }] }], hedgeAfterMs: 50 })).rejects.toMatchObject({ reason: 'BUSY' });
    expect(n).toBeGreaterThan(1);
  });
});

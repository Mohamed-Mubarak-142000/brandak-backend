import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env';

/** Google's alias for the current Flash model. */
export const LATEST_MODEL = 'gemini-flash-latest';
/** Tried in order when the configured model is busy or gone (all read photos, all free-tier). */
export const FALLBACK_MODELS = [LATEST_MODEL, 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-lite-latest'];
/** Statuses that mean "try the next model" (busy, rate-limited, retired, timed out). */
const RETRY_STATUSES = [404, 429, 500, 503, 504];

export interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  functionCall?: GeminiFunctionCall;
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
  /** Gemini 3 models sign their reasoning; parts must be sent back untouched. */
  thoughtSignature?: string;
  thought?: boolean;
}

export interface GeminiContent {
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
}

/** An OpenAPI-subset schema as Gemini expects it (type names in upper case). */
export interface GeminiSchema {
  type: 'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY';
  description?: string;
  enum?: string[];
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiSchema;
}

export interface GenerateRequest {
  systemInstruction?: string;
  contents: GeminiContent[];
  tools?: { functionDeclarations: GeminiFunctionDeclaration[] }[];
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'ANY' | 'NONE'; allowedFunctionNames?: string[] } };
  generationConfig?: Record<string, unknown>;
  /** Longest a single model call may take (default 18s). */
  timeoutMs?: number;
  /** No fallback model is started after this much time (default 42s). */
  budgetMs?: number;
  /** Hard stop for the last call, from startedAt (default budgetMs + 12s). */
  deadlineMs?: number;
  /** When the clock for the budget started (default now), e.g. before fetching images. */
  startedAt?: number;
  /** Tried first (e.g. the model that answered the previous round of a tool loop). */
  preferModel?: string;
}

export interface GenerateResult {
  candidate: GeminiCandidate | undefined;
  model: string;
}

export class GeminiError extends Error {
  constructor(
    readonly reason: 'BUSY' | 'FAILED' | 'DISABLED',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Joined text of a candidate's parts (reasoning parts left out). */
export const candidateText = (c?: GeminiCandidate) =>
  (c?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();

/** What a tool returns to the model: any JSON object. Errors are `{ error: 'CODE' }`. */
export type ToolResult = Record<string, unknown>;

export interface Tool {
  declaration: GeminiFunctionDeclaration;
  handler: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

export interface RunWithToolsInput {
  system: string;
  /** Earlier turns, oldest first. */
  history: { role: 'user' | 'model'; text: string }[];
  userText: string;
  tools: Tool[];
  maxRounds?: number;
  budgetMs?: number;
  generationConfig?: Record<string, unknown>;
}

export interface RunWithToolsResult {
  text: string;
  calls: ToolCallRecord[];
  model: string;
  rounds: number;
}

/**
 * Google Gemini over REST (free tier from Google AI Studio). Disabled when GEMINI_API_KEY is not set.
 * Free-tier models are often "busy" (503), rate-limited (429) or retired (404), so each call walks
 * a chain of models until one answers or the time budget runs out.
 */
@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);
  private readonly key: string | undefined;
  private readonly model: string;
  /** The model that answered last; chats try it first for a minute (free models are often busy). */
  private lastGood: { model: string; at: number } | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.key = config.get('GEMINI_API_KEY', { infer: true }) || undefined;
    this.model = config.get('GEMINI_MODEL', { infer: true }) || LATEST_MODEL;
  }

  get enabled() {
    return !!this.key;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!this.key) throw new GeminiError('DISABLED', 0, 'GEMINI_API_KEY is not set');
    const started = req.startedAt ?? Date.now();
    const timeoutMs = req.timeoutMs ?? 18_000;
    const budgetMs = req.budgetMs ?? 42_000;
    // A call started near the end of the budget still gets a fair try, but never past this.
    const deadline = req.deadlineMs ?? budgetMs + 12_000;
    const body = JSON.stringify({
      ...(req.systemInstruction ? { systemInstruction: { parts: [{ text: req.systemInstruction }] } } : {}),
      contents: req.contents,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(req.toolConfig ? { toolConfig: req.toolConfig } : {}),
      ...(req.generationConfig ? { generationConfig: req.generationConfig } : {}),
    });

    const chain = [...new Set([...(req.preferModel ? [req.preferModel] : []), this.model, ...FALLBACK_MODELS])];
    let model = chain[0];
    let res = await this.call(model, body, Math.max(1_000, Math.min(timeoutMs, deadline - (Date.now() - started))));
    for (const next of chain.slice(1)) {
      if (!RETRY_STATUSES.includes(res.status) || Date.now() - started > budgetMs) break;
      this.logger.warn(`Gemini ${model} answered ${res.status}, trying ${next}`);
      model = next;
      const left = deadline - (Date.now() - started);
      if (left < 2_000) break;
      res = await this.call(model, body, Math.min(left, Math.max(8_000, Math.min(timeoutMs, left))));
    }
    if (res.ok) this.lastGood = { model, at: Date.now() };
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      this.logger.warn(`Gemini ${res.status}: ${detail}`);
      throw new GeminiError([429, 503, 504].includes(res.status) ? 'BUSY' : 'FAILED', res.status, `gemini ${res.status}`);
    }
    const json = (await res.json()) as { candidates?: GeminiCandidate[] };
    this.logger.log(`answered in ${Date.now() - started}ms with ${model}`);
    return { candidate: json.candidates?.[0], model };
  }

  /**
   * Lets the model call tools until it writes an answer: call → run the requested tools (in
   * parallel) → send their results back → repeat. The last round forbids tools so it must answer.
   * Unknown tools and failing handlers become `{ error }` results for the model; never thrown.
   */
  async runWithTools(input: RunWithToolsInput): Promise<RunWithToolsResult> {
    const maxRounds = input.maxRounds ?? 4;
    const budgetMs = input.budgetMs ?? 40_000;
    const started = Date.now();
    const byName = new Map(input.tools.map((t) => [t.declaration.name, t]));
    const contents: GeminiContent[] = [
      ...input.history.filter((h) => h.text.trim()).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: input.userText }] },
    ];
    // Gemini wants the conversation to open with the user.
    while (contents.length > 1 && contents[0].role !== 'user') contents.shift();

    const calls: ToolCallRecord[] = [];
    let model: string | undefined = this.lastGood && Date.now() - this.lastGood.at < 60_000 ? this.lastGood.model : undefined;
    for (let round = 1; round <= maxRounds; round++) {
      const last = round === maxRounds || Date.now() - started > budgetMs * 0.75;
      const { candidate, model: used } = await this.generate({
        systemInstruction: input.system,
        contents,
        tools: input.tools.length ? [{ functionDeclarations: input.tools.map((t) => t.declaration) }] : undefined,
        toolConfig: input.tools.length && last ? { functionCallingConfig: { mode: 'NONE' } } : undefined,
        generationConfig: input.generationConfig,
        startedAt: started,
        // No new fallback model late in the budget, and never past it (the server stops at 60s).
        budgetMs: budgetMs - 8_000,
        deadlineMs: budgetMs,
        timeoutMs: 12_000,
        preferModel: model,
      });
      model = used;
      const parts = candidate?.content?.parts ?? [];
      const requested = parts.map((p) => p.functionCall).filter((c): c is GeminiFunctionCall => !!c?.name);
      if (!requested.length || last) return { text: candidateText(candidate), calls, model: used, rounds: round };

      contents.push({ role: 'model', parts });
      const results = await Promise.all(
        requested.map(async (call) => {
          const args = call.args && typeof call.args === 'object' ? call.args : {};
          const tool = byName.get(call.name);
          let result: ToolResult;
          if (!tool) result = { error: 'UNKNOWN_TOOL', message: `No tool named ${call.name}` };
          else {
            try {
              result = (await tool.handler(args)) ?? {};
            } catch (e) {
              this.logger.warn(`tool ${call.name} failed: ${(e as Error).message}`);
              result = { error: 'TOOL_FAILED' };
            }
          }
          calls.push({ name: call.name, args, result });
          return { functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: result } };
        }),
      );
      contents.push({ role: 'user', parts: results });
    }
    /* istanbul ignore next -- the last round always returns */
    return { text: '', calls, model: model ?? this.model, rounds: maxRounds };
  }

  /** A timeout or network error reads as 504 so the caller moves on to the next model. */
  private async call(model: string, body: string, timeoutMs: number): Promise<Pick<Response, 'ok' | 'status' | 'text' | 'json'>> {
    try {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key! },
        signal: AbortSignal.timeout(timeoutMs),
        body,
      });
    } catch (e) {
      const message = (e as Error).message;
      return { ok: false, status: 504, text: async () => message, json: async () => ({}) };
    }
  }
}

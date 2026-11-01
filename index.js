import { randomUUID } from 'node:crypto';

export const inject = ['authorization', 'credentials', 'connection'];
export const CREDENTIAL_KEY = 'llm-pi-ai/openai-codex';
const PREFIX = '/api/local-chatgpt-oauth/';
const ATTEMPT_MS = 10 * 60 * 1000;
const RETAIN_MS = 60 * 1000;
const MAX_BODY = 16 * 1024;
const MESSAGES = Object.freeze({
  BAD_REQUEST: 'Invalid request.',
  FORBIDDEN: 'Request origin or required security header was rejected.',
  TOO_LARGE: 'Request body is too large.',
  UNAVAILABLE: 'The native ChatGPT authorization flow is not available.',
  BUSY: 'A ChatGPT sign-in is already running.',
  NOT_FOUND: 'This sign-in attempt is no longer available.',
  NO_PROMPT: 'This sign-in question is no longer active.',
  FAILED: 'ChatGPT sign-in failed. Please try again.',
  INTERNAL: 'The request could not be completed.',
  TIMEOUT: 'Sign-in timed out. Please start again.',
});

class PublicError extends Error {
  constructor(code, status = 400) { super(MESSAGES[code]); this.code = code; this.status = status; }
}
const abortError = () => new DOMException('Authorization interaction ended.', 'AbortError');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value, max = 8192) => typeof value === 'string' && value.length <= max;
const text = (value, max = 4096) => typeof value === 'string' ? value.slice(0, max) : '';
function exactObject(value, keys) {
  if (!plainObject(value) || Object.keys(value).some(key => !keys.includes(key))) throw new PublicError('BAD_REQUEST');
}
function publicError(code) { return { code, message: MESSAGES[code] }; }
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

/** The Connection /api carrier authenticates and admits owner Peers before dispatch. */
async function readRequest(request) {
  if (request.method !== 'POST') throw new PublicError('BAD_REQUEST', 405);
  if (request.headers.get('x-dsh-codex-oauth') !== '1') throw new PublicError('FORBIDDEN', 403);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  // Connection already authenticates owner Peers and validates Host/Origin.
  // Desktop's dsh-app://app forwarding bridge intentionally strips Origin and
  // supplies the Host-owned cookie. A missing Origin is therefore legitimate;
  // the mandatory non-simple header and JSON body remain required on every call.
  // When Origin is supplied by a Web client, compare its actual Host authority,
  // not request.url's synthetic http://dsh.internal bridge origin.
  if (origin !== null) {
    try {
      const source = new URL(origin);
      if (!['http:', 'https:'].includes(source.protocol) || source.origin !== origin || !host ||
          new URL(`${source.protocol}//${host}`).host !== source.host) throw new Error();
    } catch { throw new PublicError('FORBIDDEN', 403); }
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PublicError('FORBIDDEN', 403);
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new PublicError('BAD_REQUEST', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw new PublicError('TOO_LARGE', 413);
  if (!request.body) throw new PublicError('BAD_REQUEST');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new PublicError('TOO_LARGE', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!plainObject(body)) throw new Error();
    return body;
  } catch { throw new PublicError('BAD_REQUEST'); }
}

function serializeNotice(notice) {
  const result = { message: text(notice?.message) };
  if (boundedString(notice?.code, 256)) result.code = notice.code;
  if (boundedString(notice?.url, 8192)) {
    try {
      const url = new URL(notice.url);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) result.url = notice.url;
    } catch { /* A malformed or unsafe URL is never sent to the UI. */ }
  }
  return result;
}
function serializePrompt(prompt, id) {
  if (!plainObject(prompt) || !['text', 'secret', 'select'].includes(prompt.kind)) throw new Error('Unsupported authorization prompt.');
  const result = { id, kind: prompt.kind, message: text(prompt.message) };
  if (boundedString(prompt.placeholder, 512)) result.placeholder = prompt.placeholder;
  if (prompt.kind === 'select') {
    if (!Array.isArray(prompt.options) || prompt.options.length < 1 || prompt.options.length > 100) throw new Error('Unsupported authorization selection.');
    result.options = prompt.options.map(option => {
      if (boundedString(option, 1024)) return { value: option, label: option };
      // The installed native pi-ai flow uses { id, label }, not { value, label }.
      // Normalize its ID to the card's wire value without changing the reply.
      if (plainObject(option) && boundedString(option.label, 1024)) {
        const value = typeof option.id === 'string' ? option.id : option.value;
        if (boundedString(value, 1024)) return { value, label: option.label };
      }
      throw new Error('Unsupported authorization selection.');
    });
    if (new Set(result.options.map(option => option.value)).size !== result.options.length) throw new Error('Ambiguous authorization selection.');
  }
  return result;
}

/** Exported only to allow deterministic, credential-free unit tests. */
export function createHost(ctx, options = {}) {
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const uuid = options.randomUUID ?? randomUUID;
  let attempt;
  let disposed = false;
  let logoutBusy = false;

  const flow = () => ctx.authorization.describe(CREDENTIAL_KEY);
  const nativeBusy = () => Boolean(flow()?.inFlight);
  const active = () => attempt?.state === 'running';
  function clearPrompt(current, reason = abortError()) {
    const pending = current.pending;
    if (!pending) return;
    current.pending = undefined;
    pending.cleanup();
    pending.reject(reason);
  }
  function withdraw(current) {
    current.controller.abort();
    clearPrompt(current);
    // Never cancel a different surface's native attempt after ours settled.
    if (current.state === 'running' && current.started) ctx.authorization.cancel(CREDENTIAL_KEY);
  }
  function forget(current) {
    if (attempt !== current) return;
    clearTimer(current.timer);
    clearPrompt(current);
    current.notices.length = 0;
    attempt = undefined;
  }
  function settle(current, state, errorCode) {
    if (disposed || attempt !== current) return;
    clearTimer(current.timer);
    clearPrompt(current);
    current.state = state;
    current.error = errorCode ? publicError(errorCode) : undefined;
    current.timer = setTimer(() => forget(current), RETAIN_MS);
    current.timer?.unref?.();
  }
  function start() {
    if (logoutBusy || active() || nativeBusy()) throw new PublicError('BUSY', 409);
    const available = flow();
    if (!available?.methods?.some(method => method.id === 'oauth')) throw new PublicError('UNAVAILABLE', 503);
    if (attempt) forget(attempt);
    const current = {
      id: uuid(), controller: new AbortController(), state: 'running',
      notices: [], pending: undefined, started: false, timedOut: false, timer: undefined,
    };
    attempt = current;
    current.timer = setTimer(() => {
      if (attempt !== current || current.state !== 'running') return;
      current.timedOut = true;
      withdraw(current);
      // The seam normally settles cancellation immediately. Retain no orphaned
      // UI state indefinitely even when a broken provider ignores cancellation.
      settle(current, 'cancelled', 'TIMEOUT');
    }, ATTEMPT_MS);
    current.timer?.unref?.();
    Promise.resolve().then(async () => {
      if (disposed || current.controller.signal.aborted) return { status: 'cancelled' };
      current.started = true;
      return ctx.authorization.begin({
        key: CREDENTIAL_KEY,
        method: 'oauth',
        signal: current.controller.signal,
        interaction: {
          notify(notice) {
            if (attempt !== current || current.state !== 'running' || current.controller.signal.aborted) return;
            current.notices.push(serializeNotice(notice));
            if (current.notices.length > 24) current.notices.shift();
          },
          prompt(prompt) {
            if (attempt !== current || current.state !== 'running' || current.controller.signal.aborted || prompt.signal?.aborted) return Promise.reject(abortError());
            if (current.pending) return Promise.reject(new Error('Concurrent authorization prompts are unsupported.'));
            const wire = serializePrompt(prompt, uuid());
            return new Promise((resolve, reject) => {
              const withdrawn = () => {
                if (current.pending?.wire.id === wire.id) clearPrompt(current);
              };
              const cleanup = () => prompt.signal?.removeEventListener('abort', withdrawn);
              current.pending = { wire, resolve, reject, cleanup };
              prompt.signal?.addEventListener('abort', withdrawn, { once: true });
              // Cover abort between the preflight check and listener installation.
              if (prompt.signal?.aborted || current.controller.signal.aborted) withdrawn();
            });
          },
        },
      });
    }).then(outcome => {
      if (outcome?.status === 'authorized') settle(current, 'authorized');
      else settle(current, 'cancelled', current.timedOut ? 'TIMEOUT' : undefined);
    }, () => {
      if (current.controller.signal.aborted) settle(current, 'cancelled', current.timedOut ? 'TIMEOUT' : undefined);
      else settle(current, 'failed', 'FAILED');
    });
    return { ok: true, attemptId: current.id };
  }
  function owned(body) {
    if (!boundedString(body.attemptId, 128) || !body.attemptId) throw new PublicError('BAD_REQUEST');
    if (!attempt || attempt.id !== body.attemptId) throw new PublicError('NOT_FOUND', 404);
    return attempt;
  }

  const actions = {
    async status(body) {
      exactObject(body, []);
      const info = await ctx.credentials.describeRecord(CREDENTIAL_KEY);
      const available = flow();
      return {
        ok: true, available: Boolean(available?.methods?.some(method => method.id === 'oauth')),
        configured: Boolean(info?.configured), inFlight: active() || nativeBusy() || logoutBusy,
      };
    },
    start(body) { exactObject(body, []); return start(); },
    poll(body) {
      exactObject(body, ['attemptId']);
      const current = owned(body);
      return {
        ok: true, state: current.state, notices: current.notices.slice(),
        prompt: current.pending?.wire ?? null,
        ...(current.error ? { error: current.error } : {}),
      };
    },
    reply(body) {
      exactObject(body, ['attemptId', 'promptId', 'value']);
      const current = owned(body);
      if (!boundedString(body.promptId, 128) || !boundedString(body.value)) throw new PublicError('BAD_REQUEST');
      const pending = current.pending;
      if (current.state !== 'running' || !pending || pending.wire.id !== body.promptId) throw new PublicError('NO_PROMPT', 409);
      if (pending.wire.kind === 'select' && !pending.wire.options.some(option => option.value === body.value)) throw new PublicError('BAD_REQUEST');
      current.pending = undefined;
      pending.cleanup();
      pending.resolve(body.value);
      return { ok: true };
    },
    cancel(body) {
      exactObject(body, ['attemptId']);
      const current = owned(body);
      if (current.state === 'running') withdraw(current);
      return { ok: true };
    },
    async logout(body) {
      exactObject(body, []);
      if (logoutBusy || active() || nativeBusy()) throw new PublicError('BUSY', 409);
      logoutBusy = true;
      try { await ctx.credentials.deleteRecord(CREDENTIAL_KEY); }
      finally { logoutBusy = false; }
      return { ok: true };
    },
  };

  async function handle(action, request) {
    try {
      if (disposed) throw new PublicError('UNAVAILABLE', 503);
      const body = await readRequest(request);
      return json(await actions[action](body));
    } catch (error) {
      const known = error instanceof PublicError;
      return json({ ok: false, error: publicError(known ? error.code : 'INTERNAL') }, known ? error.status : 500);
    }
  }
  return {
    register() {
      for (const action of Object.keys(actions)) ctx.connection.fetch.register({
        path: PREFIX + action, methods: ['POST'], requestBody: 'buffered',
        fetch: request => handle(action, request),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (attempt) {
        withdraw(attempt);
        clearTimer(attempt.timer);
        attempt.notices.length = 0;
        attempt = undefined;
      }
    },
  };
}

export function apply(ctx) {
  const host = createHost(ctx);
  host.register();
  ctx.effect(() => () => host.dispose());
}

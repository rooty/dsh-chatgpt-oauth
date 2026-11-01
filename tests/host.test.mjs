import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost, CREDENTIAL_KEY } from '../index.js';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(run) {
  const routes = new Map();
  const timers = new Map();
  const calls = [];
  let id = 0, timerId = 0, configured = false, available = true, inFlight = false;
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); } } },
    authorization: {
      describe(key) {
        assert.equal(key, CREDENTIAL_KEY);
        return available ? { key, methods: [{ id: 'oauth' }], inFlight } : undefined;
      },
      async begin(request) {
        calls.push(['begin', request.key, request.method]);
        inFlight = true;
        try {
          return await Promise.race([
            Promise.resolve().then(() => run?.(request) ?? new Promise(() => {})),
            new Promise(resolve => request.signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true })),
          ]);
        } finally { inFlight = false; }
      },
      cancel(key) { calls.push(['cancel', key]); },
    },
    credentials: {
      async describeRecord(key) { calls.push(['describe', key]); return { configured, kind: configured ? 'grant' : undefined, writable: true }; },
      async deleteRecord(key) { calls.push(['delete', key]); configured = false; },
      readRecord() { throw new Error('SECRET READ MUST NEVER HAPPEN'); },
      modifyRecord() { throw new Error('SECRET WRITE MUST NEVER HAPPEN'); },
    },
  };
  const host = createHost(ctx, {
    randomUUID: () => `opaque-id-${++id}`,
    setTimeout: (callback, ms) => { const key = ++timerId; timers.set(key, { callback, ms }); return key; },
    clearTimeout: key => timers.delete(key),
  });
  host.register();
  function request(action, body = {}, headers = {}) {
    const requestHeaders = new Headers({ origin: 'http://127.0.0.1:65079', host: '127.0.0.1:65079', 'content-type': 'application/json', 'x-dsh-codex-oauth': '1' });
    for (const [name, value] of Object.entries(headers)) {
      if (value === null) requestHeaders.delete(name);
      else requestHeaders.set(name, value);
    }
    return new Request(`http://dsh.internal/api/local-chatgpt-oauth/${action}`, {
      method: 'POST',
      headers: requestHeaders,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }
  async function call(action, body = {}, headers = {}) {
    const response = await routes.get(`/api/local-chatgpt-oauth/${action}`).fetch(request(action, body, headers));
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  return { host, routes, calls, call, request, timers, setConfigured: value => configured = value, setAvailable: value => available = value, setInFlight: value => inFlight = value };
}

test('registers exact authenticated-carrier route options and safe status metadata only', async () => {
  const f = fixture();
  assert.equal(f.routes.size, 6);
  for (const route of f.routes.values()) {
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(route.requestBody, 'buffered');
  }
  f.setConfigured(true);
  const result = await f.call('status');
  assert.deepEqual(result.data, { ok: true, available: true, configured: true, inFlight: false });
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.calls, [['describe', CREDENTIAL_KEY]]);
  f.setAvailable(false);
  assert.equal((await f.call('status')).data.available, false);
  f.host.dispose();
});

// These unit tests dispatch after Connection's authenticated owner admission;
// they do not model or bypass that carrier's Host fence and cookie checks.
test('accepts Desktop forwarded status without Origin after authenticated owner admission', async () => {
  const f = fixture();
  const request = f.request('status', {}, { origin: null, 'sec-fetch-site': null });
  assert.equal(request.headers.has('origin'), false);
  assert.equal(request.headers.get('host'), '127.0.0.1:65079');
  const response = await f.routes.get('/api/local-chatgpt-oauth/status').fetch(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, available: true, configured: false, inFlight: false });
  f.host.dispose();
});

test('rejects Desktop forwarded request without the mandatory custom header', async () => {
  const f = fixture();
  const result = await f.call('status', {}, { origin: null, 'x-dsh-codex-oauth': null });
  assert.equal(result.status, 403);
  assert.equal(result.data.error.code, 'FORBIDDEN');
  assert.equal(f.calls.length, 0);
  f.host.dispose();
});

test('accepts real Web Origin matching Host despite synthetic bridge request URL', async () => {
  const f = fixture();
  for (const origin of ['http://127.0.0.1:65079', 'https://127.0.0.1:65079']) {
    const result = await f.call('status', {}, { origin });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
  }
  f.host.dispose();
});

test('rejects missing security header, empty/foreign/null Origin, wrong port and cross-site', async () => {
  const f = fixture();
  for (const headers of [
    { 'x-dsh-codex-oauth': '' }, { origin: '' }, { origin: 'null' },
    { origin: 'https://evil.example' }, { origin: 'http://127.0.0.1:1' },
    { origin: 'http://127.0.0.1:65079/path' }, { 'sec-fetch-site': 'cross-site' },
  ]) {
    const result = await f.call('start', {}, headers);
    assert.equal(result.status, 403);
    assert.equal(result.data.error.code, 'FORBIDDEN');
  }
  assert.equal(f.calls.length, 0);
  f.host.dispose();
});

test('validates JSON type, byte limit, exact payload fields and types', async () => {
  const f = fixture();
  for (const body of ['{', '[]', 'null', '{"unexpected":true}']) assert.equal((await f.call('status', body)).status, 400);
  assert.equal((await f.call('start', {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await f.call('start', ' '.repeat(16385))).status, 413);
  assert.equal((await f.call('start', {}, { 'content-length': '16385' })).status, 413);
  assert.equal((await f.call('poll', { attemptId: 1 })).status, 400);
  assert.equal((await f.call('poll', { attemptId: 'unknown' })).status, 404);
  f.host.dispose();
});

test('starts only existing oauth flow and refuses native or local concurrent attempts', async () => {
  const f = fixture();
  f.setAvailable(false);
  assert.equal((await f.call('start')).status, 503);
  f.setAvailable(true);
  f.setInFlight(true);
  assert.equal((await f.call('start')).status, 409);
  f.setInFlight(false);
  const started = await f.call('start');
  assert.equal(started.status, 200);
  assert.equal(typeof started.data.attemptId, 'string');
  assert.equal((await f.call('start')).status, 409);
  assert.deepEqual(f.calls.find(call => call[0] === 'begin'), ['begin', CREDENTIAL_KEY, 'oauth']);
  f.host.dispose();
});

test('relays native notices, text and secret prompts without credential data', async () => {
  const values = [];
  const f = fixture(async request => {
    request.interaction.notify({ message: 'Continue', url: 'https://auth.openai.com/oauth/authorize?state=opaque' });
    request.interaction.notify({ message: 'Ignore unsafe URL', url: 'javascript:alert(1)' });
    values.push(await request.interaction.prompt({ kind: 'text', message: 'Paste code', placeholder: 'code' }));
    values.push(await request.interaction.prompt({ kind: 'secret', message: 'Secret code' }));
    return { status: 'authorized' };
  });
  const { attemptId } = (await f.call('start')).data;
  await flush();
  let poll = (await f.call('poll', { attemptId })).data;
  assert.equal(poll.state, 'running');
  assert.equal(poll.notices[0].url.startsWith('https://auth.openai.com/'), true);
  assert.equal('url' in poll.notices[1], false);
  assert.equal(poll.prompt.kind, 'text');
  assert.equal((await f.call('reply', { attemptId, promptId: poll.prompt.id, value: ' code-exact ' })).status, 200);
  await flush();
  poll = (await f.call('poll', { attemptId })).data;
  assert.equal(poll.prompt.kind, 'secret');
  const secret = 'secret-never-echo';
  assert.equal((await f.call('reply', { attemptId, promptId: poll.prompt.id, value: secret })).status, 200);
  await flush();
  poll = (await f.call('poll', { attemptId })).data;
  assert.equal(poll.state, 'authorized');
  assert.equal(poll.prompt, null);
  assert.equal(JSON.stringify(poll).includes(secret), false);
  assert.deepEqual(values, [' code-exact ', secret]);
  f.host.dispose();
});

test('selection accepts only listed option value strings and rejects stale prompt replies', async () => {
  let selected;
  const f = fixture(async request => {
    selected = await request.interaction.prompt({ kind: 'select', message: 'Choose', options: [{ value: 'one', label: 'First' }, 'two'] });
    return { status: 'authorized' };
  });
  const { attemptId } = (await f.call('start')).data;
  await flush();
  const prompt = (await f.call('poll', { attemptId })).data.prompt;
  assert.deepEqual(prompt.options, [{ value: 'one', label: 'First' }, { value: 'two', label: 'two' }]);
  assert.equal((await f.call('reply', { attemptId, promptId: prompt.id, value: 'First' })).status, 400);
  assert.equal((await f.call('reply', { attemptId, promptId: prompt.id, value: 'one' })).status, 200);
  await flush();
  assert.equal(selected, 'one');
  assert.equal((await f.call('reply', { attemptId, promptId: prompt.id, value: 'one' })).status, 409);
  f.host.dispose();
});

test('native pi-ai login method options use id and preserve browser/device_code replies', async () => {
  for (const method of ['browser', 'device_code']) {
    let selected;
    const f = fixture(async request => {
      selected = await request.interaction.prompt({ kind: 'select', message: 'Select OpenAI Codex login method:', options: [
        { id: 'browser', label: 'Browser login (default)' },
        { id: 'device_code', label: 'Device code login (headless)' },
      ] });
      return { status: 'authorized' };
    });
    const { attemptId } = (await f.call('start')).data;
    await flush();
    const state = (await f.call('poll', { attemptId })).data;
    assert.equal(state.state, 'running');
    assert.deepEqual(state.prompt.options.map(option => option.value), ['browser', 'device_code']);
    assert.equal((await f.call('reply', { attemptId, promptId: state.prompt.id, value: method })).status, 200);
    await flush();
    assert.equal(selected, method);
    assert.equal((await f.call('poll', { attemptId })).data.state, 'authorized');
    f.host.dispose();
  }
});

test('prompt signal withdraws a losing question without declining the whole flow', async () => {
  const gate = deferred();
  const promptController = new AbortController();
  const f = fixture(async request => {
    const prompt = request.interaction.prompt({ kind: 'text', message: 'Paste code', signal: promptController.signal });
    await assert.rejects(prompt, { name: 'AbortError' });
    await gate.promise;
    return { status: 'authorized' };
  });
  const { attemptId } = (await f.call('start')).data;
  await flush();
  promptController.abort();
  await flush();
  assert.equal((await f.call('poll', { attemptId })).data.prompt, null);
  assert.equal((await f.call('poll', { attemptId })).data.state, 'running');
  gate.resolve();
  await flush();
  assert.equal((await f.call('poll', { attemptId })).data.state, 'authorized');
  f.host.dispose();
});

test('provider failures and malformed internal prompts never expose exception messages', async () => {
  for (const run of [
    async () => { throw new Error('secret-access-token'); },
    async request => { await request.interaction.prompt({ kind: 'select', message: 'select', options: [{ secret: 'secret-access-token' }] }); },
  ]) {
    const f = fixture(run);
    const { attemptId } = (await f.call('start')).data;
    await flush();
    const poll = (await f.call('poll', { attemptId })).data;
    assert.equal(poll.state, 'failed');
    assert.equal(poll.error.code, 'FAILED');
    assert.equal(JSON.stringify(poll).includes('secret-access-token'), false);
    f.host.dispose();
  }
});

test('cancel is scoped by opaque ID, settles locally and clears pending prompt', async () => {
  const f = fixture(async request => {
    try { await request.interaction.prompt({ kind: 'secret', message: 'Code' }); }
    catch { return { status: 'cancelled' }; }
  });
  const { attemptId } = (await f.call('start')).data;
  await flush();
  assert.equal((await f.call('cancel', { attemptId: 'another-page' })).status, 404);
  assert.equal((await f.call('cancel', { attemptId })).status, 200);
  await flush();
  const poll = (await f.call('poll', { attemptId })).data;
  assert.equal(poll.state, 'cancelled');
  assert.equal(poll.prompt, null);
  assert.equal(f.calls.some(call => call[0] === 'cancel'), true);
  f.host.dispose();
});

test('ten-minute timeout cancels and settled state expires after bounded retention', async () => {
  const f = fixture();
  const { attemptId } = (await f.call('start')).data;
  await flush();
  const timeout = [...f.timers.values()].find(timer => timer.ms === 600000);
  assert.ok(timeout);
  timeout.callback();
  await flush();
  const poll = (await f.call('poll', { attemptId })).data;
  assert.equal(poll.state, 'cancelled');
  assert.equal(poll.error.code, 'TIMEOUT');
  const retention = [...f.timers.values()].find(timer => timer.ms === 60000);
  assert.ok(retention);
  retention.callback();
  assert.equal((await f.call('poll', { attemptId })).status, 404);
  f.host.dispose();
});

test('logout deletes only native local record and refuses while authorization runs', async () => {
  const f = fixture();
  f.setConfigured(true);
  assert.equal((await f.call('logout')).status, 200);
  assert.deepEqual(f.calls, [['delete', CREDENTIAL_KEY]]);
  assert.equal((await f.call('status')).data.configured, false);
  await f.call('start');
  assert.equal((await f.call('logout')).status, 409);
  f.host.dispose();
});

test('disposal cancels running flow, removes timers, rejects future requests', async () => {
  const f = fixture();
  await f.call('start');
  await flush();
  f.host.dispose();
  await flush();
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.some(call => call[0] === 'cancel'), true);
  assert.equal((await f.call('status')).status, 503);
});

test('new attempt discards prior terminal state rather than accumulating sessions', async () => {
  const f = fixture(async () => ({ status: 'authorized' }));
  const first = (await f.call('start')).data.attemptId;
  await flush();
  assert.equal((await f.call('poll', { attemptId: first })).data.state, 'authorized');
  const second = (await f.call('start')).data.attemptId;
  assert.notEqual(second, first);
  assert.equal((await f.call('poll', { attemptId: first })).status, 404);
  f.host.dispose();
});

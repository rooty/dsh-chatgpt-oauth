// Run only with the bundled Desktop Electron runtime (ELECTRON_RUN_AS_NODE=1).
// Uses the ACTUAL installed pi-ai adapter and authorization seam, but entirely
// synthetic in-memory credentials. Browser login generates a URL and may open
// its short-lived loopback callback listener; no browser, token exchange, or
// remote request is started. Cancellation closes the listener.
import assert from 'node:assert/strict';
import { createHost, CREDENTIAL_KEY } from '../index.js';

const base = 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/dsh/node_modules/';
const { Context } = await import(base + '@deepseek-ai/cordis/lib/index.js');
const { AuthorizationService } = await import(base + '@deepseek-ai/dsh-authorization/lib/index.js');
const pi = await import(base + '@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
const ctx = new Context();
ctx.provide('credentials', {
  async describeRecord() { return { configured: false, writable: true }; },
  async readRecord() { return undefined; },
  async listRecords() { return []; },
  async resolve() { return undefined; },
  async modifyRecord() { throw new Error('Unexpected credential write in prompt-only test'); },
});
ctx.provide('llm', {
  registerConfigurableProviders() { return { replace() {} }; },
  registerModelDiscovery() { return () => {}; },
  registerAdapter() { throw new Error('Test must not register a model route'); },
});
const auth = ctx.plugin(AuthorizationService);
const adapter = ctx.plugin({
  name: 'native-adapter-smoke', inject: ['authorization', 'llm'],
  apply(child) { pi.apply(child, { providers: { get: () => ({}) } }); },
});
await new Promise(setImmediate);
assert.ok(ctx.authorization.describe(CREDENTIAL_KEY));
const routes = new Map();
const manualPrompt = Promise.withResolvers();
const authorization = {
  describe: key => ctx.authorization.describe(key),
  cancel: key => ctx.authorization.cancel(key),
  begin(request) {
    return ctx.authorization.begin({ ...request, interaction: {
      notify: notice => request.interaction.notify(notice),
      prompt(prompt) {
        const result = request.interaction.prompt(prompt);
        if (prompt.kind === 'text') manualPrompt.resolve();
        return result;
      },
    } });
  },
};
const host = createHost({ authorization, credentials: ctx.credentials, connection: { fetch: {
  register(route) { routes.set(route.path, route); },
} } });
host.register();
async function call(action, body = {}) {
  const response = await routes.get('/api/local-chatgpt-oauth/' + action).fetch(new Request('http://dsh.internal/api/local-chatgpt-oauth/' + action, {
    method: 'POST', headers: { host: '127.0.0.1:51219', 'content-type': 'application/json', 'x-dsh-codex-oauth': '1' },
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 200);
  return response.json();
}
let attemptId;
let deadline;
try {
  ({ attemptId } = await call('start'));
  await new Promise(setImmediate);
  let state = await call('poll', { attemptId });
  assert.equal(state.state, 'running');
  assert.equal(state.prompt.kind, 'select');
  assert.deepEqual(state.prompt.options.map(option => option.value), ['browser', 'device_code']);
  await call('reply', { attemptId, promptId: state.prompt.id, value: 'browser' });
  await Promise.race([manualPrompt.promise, new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Native browser login did not reach manual prompt')), 5000);
  })]);
  state = await call('poll', { attemptId });
  assert.equal(state.state, 'running');
  assert.equal(state.prompt.kind, 'text');
  assert.ok(state.notices.some(notice => notice.url && new URL(notice.url).hostname === 'auth.openai.com'));
  console.log('PASS: installed native Codex flow → method selection → browser OAuth URL → manual callback prompt, through Desktop-shaped requests. No live credentials or external requests.');
} finally {
  clearTimeout(deadline);
  if (attemptId) await call('cancel', { attemptId });
  host.dispose(); adapter.dispose(); auth.dispose();
}

// Run with bundled Electron and ELECTRON_RUN_AS_NODE=1. No real credentials,
// OAuth branch, browser, callback listener, token exchange or network request.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHost, CREDENTIAL_KEY } from '../index.js';

const base = 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/dsh/node_modules/';
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const sdk = JSON.parse(await readFile(new URL(base + '@deepseek-ai/dsh-authorization/package.json'), 'utf8'));
assert.equal(manifest.engines.dsh, sdk.version, 'Revalidate the exact SDK before starting any native flow');
globalThis.fetch = () => { throw new Error('Network is forbidden in this offline smoke'); };
const { Context } = await import(base + '@deepseek-ai/cordis/lib/index.js');
const { AuthorizationService } = await import(base + '@deepseek-ai/dsh-authorization/lib/index.js');
const pi = await import(base + '@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
const ctx = new Context();
ctx.provide('credentials', {
  async describeRecord() { return { configured: false, writable: true }; },
  async readRecord() { return undefined; },
  async listRecords() { return []; },
  async resolve() { return undefined; },
  async modifyRecord() { throw new Error('No credential writes permitted in this smoke'); },
});
ctx.provide('llm', {
  registerConfigurableProviders() { return { replace() {} }; },
  registerModelDiscovery() { return () => {}; },
  registerAdapter() { throw new Error('No model route registration permitted'); },
});
const auth = ctx.plugin(AuthorizationService);
const adapter = ctx.plugin({
  name: 'offline-native-adapter-smoke', inject: ['authorization', 'llm'],
  apply(child) { pi.apply(child, { providers: { get: () => ({}) } }); },
});
await new Promise(setImmediate);
assert.ok(ctx.authorization.describe(CREDENTIAL_KEY));
const routes = new Map();
const host = createHost({ authorization: ctx.authorization, credentials: ctx.credentials, connection: { fetch: {
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
try {
  ({ attemptId } = await call('start'));
  await new Promise(setImmediate);
  let state = await call('poll', { attemptId });
  assert.equal(state.state, 'running');
  assert.equal(state.prompt.kind, 'select');
  assert.deepEqual(state.prompt.options.map(option => option.value), ['browser', 'device_code']);
  // Deliberately do NOT answer: either choice would leave the offline boundary.
  await call('cancel', { attemptId });
  await new Promise(setImmediate);
  state = await call('poll', { attemptId });
  assert.equal(state.state, 'cancelled');
  assert.equal(ctx.authorization.describe(CREDENTIAL_KEY).inFlight, false);
  assert.equal(state.notices.length, 0);
  console.log('PASS native current SDK: method selection and cancellation; no OAuth branch, credential write or network.');
} finally {
  if (attemptId) await call('cancel', { attemptId });
  host.dispose();
  await adapter.dispose();
  await auth.dispose();
}

// Isolated real Connection carrier. Browser authentication below is synthetic;
// there are no sockets, application cookies, real credentials or OAuth calls.
import assert from 'node:assert/strict';
import { createHost } from '../index.js';
const base = 'file:///Applications/DeepSeek%20Harness.app/Contents/Resources/app.asar/dsh/node_modules/';
globalThis.fetch = () => { throw new Error('Network is forbidden in this offline smoke'); };
const { Context } = await import(base + '@deepseek-ai/cordis/lib/index.js');
const { HostConnectionService } = await import(base + '@deepseek-ai/dsh-client-connection/lib/index.js');
const ctx = new Context();
const connection = new HostConnectionService(ctx, [], {
  isAuthenticated: request => request.headers.get('x-test-owner') === 'yes',
  authenticateApi: () => undefined,
});
const host = createHost({
  authorization: { describe: () => ({ methods: [{ id: 'oauth' }], inFlight: false }) },
  credentials: { describeRecord: async () => ({ configured: false }) },
  connection,
});
host.register();
const handler = connection.createSharedFetchHandler('/api');
function request(hostname = '127.0.0.1:51219', origin, owner = true) {
  return new Request('http://dsh.internal/api/local-chatgpt-oauth/status', {
    method: 'POST', headers: {
      host: hostname, 'content-type': 'application/json', 'x-dsh-codex-oauth': '1',
      ...(origin ? { origin } : {}), ...(owner ? { 'x-test-owner': 'yes' } : {}),
    }, body: '{}',
  });
}
try {
  assert.equal(connection.admit(request('evil.example')).rejection, 403);
  assert.equal(connection.admit(request('127.0.0.1:51219', 'http://evil.example')).rejection, 403);
  assert.equal(connection.admit(request('127.0.0.1:51219', undefined, false)).rejection, 401);
  for (const origin of [undefined, 'http://127.0.0.1:51219']) {
    const req = request('127.0.0.1:51219', origin);
    const admission = connection.admit(req);
    assert.ok(admission.peer);
    const response = await handler.fetch(req, admission.peer);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).available, true);
  }
  assert.equal((await handler.fetch(request(), { principal: { kind: 'external' } })).status, 403);
  assert.throws(() => connection.fetch.register({ path: '/api/bad', method: 'POST', fetch: async () => new Response('') }));
  console.log('PASS real carrier: Desktop/Web owner admission; hostile Host/Origin, anonymous and non-owner denied. Synthetic auth only.');
} finally { host.dispose(); }

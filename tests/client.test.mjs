import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function harness(handler, { baseURI = 'http://127.0.0.1:65079/', origin = 'http://127.0.0.1:65079', pageURL = origin } = {}) {
  const hooks = [], effects = [], timers = new Map(), requests = [], popups = [], registrations = [];
  let cursor = 0, dirty = false, tree, component, props, timerId = 0, dictionary;
  const React = {
    createElement(type, elementProps, ...children) {
      return { type, props: elementProps ?? {}, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) };
    },
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: initial };
      return [hooks[index].value, value => {
        const next = typeof value === 'function' ? value(hooks[index].value) : value;
        if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; if (!hooks[index]) hooks[index] = { current: initial }; return hooks[index]; },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        hooks[index] = { dependencies, cleanup: previous?.cleanup };
        effects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); });
      }
    },
  };
  const window = {
    __ModuleLoader__: { load(row) { assert.equal(row.id, '@local/dsh-chatgpt-oauth'); const plugin = row.factory(name => { assert.equal(name, 'react'); return React; });
      plugin.apply({
        locale: {
          bind: () => key => dictionary?.[key] ?? key,
          register: (_name, locales) => { dictionary = locales.en; return () => {}; },
        },
        effect: action => action(),
        slots: {
          inject: (name, action) => { assert.equal(name, 'settings.models.footer'); return action(); },
          register: (options, Card) => { registrations.push(options); component = Card; props = options.inject(); return () => {}; },
        },
      });
    } },
    open(url, target) { const popup = { url, target, closed: false, opener: 'parent', location: url, close() { this.closed = true; } }; popups.push(popup); return popup; },
    confirm: () => true,
  };
  const context = vm.createContext({
    window, URL, document: { baseURI }, location: { origin, protocol: new URL(pageURL).protocol, hostname: new URL(pageURL).hostname },
    fetch: async (url, options) => {
      const pathname = new URL(url).pathname;
      const action = pathname.split('/').at(-1);
      const payload = JSON.parse(options.body);
      const request = { action, pathname, payload, options, url: String(url) };
      requests.push(request);
      const value = await handler(request);
      if (value instanceof Error) throw value;
      return { ok: value?.ok !== false, json: async () => value };
    },
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context, { filename: 'client.js' });
  function render() { cursor = 0; dirty = false; tree = component(props); while (effects.length) effects.shift()(); return tree; }
  async function flush() {
    for (let i = 0; i < 40; i++) { await Promise.resolve(); if (dirty) render(); }
  }
  function all(predicate, node = tree) {
    if (node === null || node === undefined || typeof node !== 'object') return [];
    return [...(predicate(node) ? [node] : []), ...node.children.flatMap(child => all(predicate, child))];
  }
  function contents(node = tree) { if (typeof node === 'string' || typeof node === 'number') return String(node); return node?.children?.map(contents).join(' ') ?? ''; }
  function button(label) { const result = all(node => node.type === 'button' && contents(node) === label)[0]; assert.ok(result, `Missing button: ${label}`); return result; }
  function unmount() { for (const hook of hooks) hook?.cleanup?.(); }
  async function tick() { const current = [...timers]; timers.clear(); for (const [, timer] of current) timer.callback(); await flush(); }
  render();
  return { flush, render, all, contents, button, requests, popups, timers, registrations, unmount, tick, get tree() { return tree; } };
}

const signedOut = { ok: true, available: true, configured: false, inFlight: false };

test('actual bundle registers footer slot, renders loading then metadata status, sends protected mounted API requests', async () => {
  const wait = deferred();
  const h = harness(() => wait.promise, { baseURI: 'http://127.0.0.1:65079/mount/' });
  assert.match(h.contents(), /Checking sign-in status/);
  assert.equal(h.button('Sign in with ChatGPT').props.disabled, true);
  assert.equal(h.registrations.length, 1);
  assert.equal(h.registrations[0].name, 'settings.models.footer');
  assert.equal(h.requests[0].pathname, '/mount/api/local-chatgpt-oauth/status');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
  assert.equal(h.requests[0].options.headers['X-DSH-Codex-OAuth'], '1');
  assert.equal(h.requests[0].options.headers['Content-Type'], 'application/json');
  wait.resolve(signedOut);
  await h.flush();
  assert.match(h.contents(), /Not signed in/);
  assert.equal(h.button('Sign in with ChatGPT').props.disabled, false);
  h.unmount();
});

test('network failure is rendered as localized error, with no provider error or credential disclosure', async () => {
  const h = harness(() => { throw new Error('access-token-secret'); });
  await h.flush();
  assert.match(h.contents(), /Could not reach the sign-in plugin/);
  assert.equal(h.all(node => node.props.role === 'alert').length, 1);
  assert.doesNotMatch(h.contents(), /access-token-secret/);
  assert.deepEqual(h.requests.map(request => request.action), ['status']);
  h.unmount();
});

test('cross-origin document base is rejected without issuing a request', async () => {
  const h = harness(() => signedOut, { baseURI: 'https://evil.example/' });
  await h.flush();
  assert.equal(h.requests.length, 0);
  assert.match(h.contents(), /Could not reach the sign-in plugin/);
  h.unmount();
});

test('unavailable native flow disables login; native busy state prevents another UI attempt', async () => {
  for (const status of [{ ...signedOut, available: false }, { ...signedOut, inFlight: true }]) {
    const h = harness(() => status);
    await h.flush();
    assert.equal(h.button('Sign in with ChatGPT').props.disabled, true);
    assert.equal(h.popups.length, 0);
    h.unmount();
  }
});

test('sign-in relays notices and exact prompt reply, then refreshes status after authorization', async () => {
  let configured = false, replied = false;
  const h = harness(request => {
    switch (request.action) {
      case 'status': return { ...signedOut, configured };
      case 'start': return { ok: true, attemptId: 'attempt-one' };
      case 'poll': return replied
        ? (configured = true, { ok: true, state: 'authorized', notices: [], prompt: null })
        : { ok: true, state: 'running', notices: [{ message: 'Open browser', url: 'https://auth.openai.com/oauth/authorize?state=public-state', code: 'ABCD' }], prompt: { id: 'prompt-one', kind: 'text', message: 'Paste callback', placeholder: 'Callback URL' } };
      case 'reply': replied = true; return { ok: true };
      case 'cancel': return { ok: true };
      default: throw new Error('Unexpected endpoint');
    }
  });
  await h.flush();
  await h.button('Sign in with ChatGPT').props.onClick();
  await h.flush();
  assert.match(h.contents(), /Open browser/);
  assert.match(h.contents(), /ABCD/);
  assert.match(h.contents(), /Paste callback/);
  assert.equal(h.popups[0].opener, null);
  assert.equal(h.popups[0].location, 'https://auth.openai.com/oauth/authorize?state=public-state');
  const input = h.all(node => node.type === 'input')[0];
  input.props.onChange({ target: { value: 'exact-callback-value' } });
  await h.flush();
  const form = h.all(node => node.type === 'form')[0];
  await form.props.onSubmit({ preventDefault() {} });
  await h.flush();
  assert.deepEqual(h.requests.find(request => request.action === 'reply').payload, { attemptId: 'attempt-one', promptId: 'prompt-one', value: 'exact-callback-value' });
  await h.tick();
  assert.match(h.contents(), /Sign-in saved/);
  assert.match(h.contents(), /A saved ChatGPT sign-in is available/);
  assert.equal(h.all(node => node.type === 'input').length, 0);
  assert.equal(h.requests.filter(request => request.action === 'status').length, 2);
  assert.ok(h.requests.every(request => ['status', 'start', 'poll', 'reply', 'cancel', 'logout'].includes(request.action)));
  h.unmount();
});

test('URL allowlist rejects non-HTTPS, credentials, lookalike domains and scripts before popup navigation or links', async () => {
  const unsafe = [
    'javascript:alert(1)', 'http://auth.openai.com/login', 'https://auth.openai.com.evil.example/login',
    'https://evil.example/?next=https://auth.openai.com', 'https://user:secret@auth.openai.com/login',
    'https://evil.openai.com/login', 'data:text/html,hello', 'not a URL',
  ];
  const h = harness(request => request.action === 'status' ? signedOut : request.action === 'start'
    ? { ok: true, attemptId: 'attempt-one' }
    : { ok: true, state: 'running', notices: [...unsafe.map(url => ({ message: 'Instruction', url })), { message: 'Trusted', url: 'https://chatgpt.com/auth/login' }], prompt: null });
  await h.flush();
  await h.button('Sign in with ChatGPT').props.onClick();
  await h.flush();
  const links = h.all(node => node.type === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].props.href, 'https://chatgpt.com/auth/login');
  assert.equal(links[0].props.rel, 'noopener noreferrer');
  assert.equal(links[0].props.referrerPolicy, 'no-referrer');
  assert.equal(h.popups[0].location, 'https://chatgpt.com/auth/login');
  h.unmount();
});

test('secret and selection prompts use protected presentation and exact option values', async () => {
  for (const prompt of [
    { id: 'secret', kind: 'secret', message: 'Secret code' },
    { id: 'select', kind: 'select', message: 'Choose account', options: [{ value: 'account-id', label: 'Work account' }] },
  ]) {
    const h = harness(request => request.action === 'status' ? signedOut : request.action === 'start'
      ? { ok: true, attemptId: 'attempt-one' }
      : request.action === 'reply' || request.action === 'cancel' ? { ok: true }
      : { ok: true, state: 'running', notices: [], prompt });
    await h.flush();
    await h.button('Sign in with ChatGPT').props.onClick();
    await h.flush();
    const field = h.all(node => node.type === (prompt.kind === 'select' ? 'select' : 'input'))[0];
    if (prompt.kind === 'secret') { assert.equal(field.props.type, 'password'); assert.equal(field.props.autoComplete, 'off'); }
    else assert.equal(h.all(node => node.type === 'option' && node.props.value === 'account-id').length, 1);
    field.props.onChange({ target: { value: prompt.kind === 'secret' ? 'private-code' : 'account-id' } });
    await h.flush();
    await h.all(node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    assert.equal(h.requests.find(request => request.action === 'reply').payload.value, prompt.kind === 'secret' ? 'private-code' : 'account-id');
    h.unmount();
  }
});

test('unmount cancels its attempt with keepalive and clears polling timer', async () => {
  const h = harness(request => request.action === 'status' ? signedOut : request.action === 'start'
    ? { ok: true, attemptId: 'attempt-one' }
    : { ok: true, state: 'running', notices: [], prompt: null });
  await h.flush();
  await h.button('Sign in with ChatGPT').props.onClick();
  await h.flush();
  assert.equal(h.timers.size, 1);
  h.unmount();
  await h.flush();
  assert.equal(h.timers.size, 0);
  const cancelled = h.requests.find(request => request.action === 'cancel');
  assert.deepEqual(cancelled.payload, { attemptId: 'attempt-one' });
  assert.equal(cancelled.options.keepalive, true);
  assert.equal(h.popups[0].closed, true);
});

test('late start response after unmount is cancelled rather than creating abandoned attempt', async () => {
  const start = deferred();
  const h = harness(request => request.action === 'status' ? signedOut : request.action === 'start' ? start.promise : { ok: true });
  await h.flush();
  const pending = h.button('Sign in with ChatGPT').props.onClick();
  await h.flush();
  h.unmount();
  start.resolve({ ok: true, attemptId: 'late-attempt' });
  await pending;
  await h.flush();
  assert.deepEqual(h.requests.find(request => request.action === 'cancel').payload, { attemptId: 'late-attempt' });
});

test('pending start disables sign-in and BUSY response is localized', async () => {
  const start = deferred();
  const h = harness(request => request.action === 'status' ? signedOut : start.promise);
  await h.flush();
  const pending = h.button('Sign in with ChatGPT').props.onClick();
  await h.flush();
  assert.equal(h.button('Sign in with ChatGPT').props.disabled, true);
  start.resolve({ ok: false, error: { code: 'BUSY', message: 'secret server details' } });
  await pending;
  await h.flush();
  assert.match(h.contents(), /Another sign-in is already running/);
  assert.doesNotMatch(h.contents(), /secret server details/);
  assert.equal(h.popups[0].closed, true);
  h.unmount();
});

test('failed terminal state is sanitized and explicit logout only calls logout endpoint', async () => {
  let configured = true;
  const h = harness(request => request.action === 'status' ? { ...signedOut, configured }
    : request.action === 'logout' ? (configured = false, { ok: true })
    : request.action === 'start' ? { ok: true, attemptId: 'attempt-one' }
    : { ok: true, state: 'failed', notices: [], prompt: null, error: { message: 'private provider details' } });
  await h.flush();
  await h.button('Sign out of DSH').props.onClick();
  await h.flush();
  assert.match(h.contents(), /Not signed in/);
  assert.equal(h.requests.filter(request => request.action === 'logout').length, 1);
  await h.button('Sign in with ChatGPT').props.onClick();
  await h.flush();
  assert.match(h.contents(), /Sign-in failed/);
  assert.doesNotMatch(h.contents(), /private provider details/);
  h.unmount();
});

test('Desktop custom scheme status works with both origin serializations and opens only the real HTTPS login once', async () => {
  for (const origin of ['null', 'dsh-app://app']) {
    const h = harness(request => request.action === 'status' ? signedOut
      : request.action === 'start' ? { ok: true, attemptId: 'native-attempt' }
      : request.action === 'cancel' ? { ok: true }
      : { ok: true, state: 'running', notices: [{ message: 'Open browser', url: 'https://auth.openai.com/oauth/authorize?state=synthetic' }], prompt: null },
      { baseURI: 'dsh-app://app/', origin, pageURL: 'dsh-app://app/' });
    await h.flush();
    assert.equal(h.requests[0].url, 'dsh-app://app/api/local-chatgpt-oauth/status');
    assert.equal(h.button('Sign in with ChatGPT').props.disabled, false);
    await h.button('Sign in with ChatGPT').props.onClick();
    await h.flush();
    assert.equal(h.popups.length, 1);
    assert.equal(h.popups[0].url, 'https://auth.openai.com/oauth/authorize?state=synthetic');
    assert.ok(h.popups.every(popup => popup.url !== 'about:blank'));
    await h.tick();
    assert.equal(h.popups.length, 1);
    assert.equal(h.all(node => node.type === 'a').length, 1);
    h.unmount();
  }
});

test('Desktop custom scheme rejects hostile base host and HTTP fallback without a request', async () => {
  for (const baseURI of ['dsh-app://evil/', 'dsh-app://app:1234/', 'https://app/', 'http://127.0.0.1:50238/']) {
    const h = harness(() => signedOut, { baseURI, origin: 'null', pageURL: 'dsh-app://app/' });
    await h.flush();
    assert.equal(h.requests.length, 0);
    assert.match(h.contents(), /Could not reach the sign-in plugin/);
    h.unmount();
  }
});

test('same-tick duplicate login invokes start and creates a popup only once', async () => {
  const start = deferred();
  const h = harness(request => request.action === 'status' ? signedOut : request.action === 'start' ? start.promise : { ok: true });
  await h.flush();
  const action = h.button('Sign in with ChatGPT').props.onClick;
  const first = action();
  const second = action();
  assert.equal(h.requests.filter(request => request.action === 'start').length, 1);
  assert.equal(h.popups.length, 1);
  start.resolve({ ok: false, error: { code: 'BUSY' } });
  await Promise.all([first, second]);
  await h.flush();
  h.unmount();
});

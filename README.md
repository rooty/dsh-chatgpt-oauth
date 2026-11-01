# Local ChatGPT OAuth for DeepSeek Harness

A minimal, user-owned plugin for **DSH 0.2.1-rc.5**. It adds a ChatGPT sign-in card to the bottom of **Settings → Models** and invokes the installed `llm-pi-ai/openai-codex` authorization flow. It does not implement its own OAuth protocol, run Codex CLI, replace DSH's provider, or configure search/image generation.

## Use

1. Open Settings → Models and find **ChatGPT / Codex sign-in**.
2. Click **Sign in with ChatGPT** / **Войти через ChatGPT**.
3. Choose **Browser login (default)** and click **Continue**, then complete sign-in on the opened OpenAI page. If the browser does not open, use **Open ChatGPT sign-in** in the card. The native flow also offers **Device code login (headless)**; follow the displayed instructions if you select it.
4. If DSH asks for a verification code or redirect URL, enter it only in the card, not in the chat.
5. After DSH reports that sign-in is saved, configure the `openai-codex` provider above as needed. Fetch available models and click Apply. This plugin intentionally preserves existing model lists, endpoints and provider overrides.

The saved-status indicator means a record exists in DSH's credential store; it does not verify subscription entitlement, token validity, backend availability, or a successful model request. Actual login and model access must be verified interactively with the account owner.

**Sign out of DSH** removes only DSH's stored `llm-pi-ai/openai-codex` record after confirmation. It does not revoke the account session at OpenAI, sign out of ChatGPT, or change Codex CLI credentials.

## Safety and lifecycle

- Exact POST routes are registered through DSH's existing Connection `/api` carrier, which admits authenticated owner Peers. The plugin starts no extra API server; the native browser OAuth flow may open its own temporary loopback callback listener on port 1455.
- Each route additionally requires JSON content type and `X-DSH-Codex-OAuth: 1`. A Web Origin, when present, must match the actual Host authority. Desktop's authenticated `dsh-app://app` bridge strips Origin by design, so missing Origin is accepted only within the existing owner-authenticated Connection carrier. Payloads are limited to 16 KiB and validated.
- Only one sign-in may run. Its random attempt ID is held by the initiating card, not published as global state; other pages receive only an in-flight boolean.
- Prompts, links and verification codes are transient. The native DSH flow writes and refreshes tokens in its own credential store; this plugin does not read or return their values.
- The card links only to a finite set of official OpenAI HTTPS hosts. It neither logs sign-in replies nor stores them in browser persistence.
- Cancellation and unmount withdraw the attempt. Attempts expire after ten minutes, terminal state after one minute. Host disposal cancels work and clears timers.
- The plugin supplies prebuilt loader-compatible browser JavaScript. Refresh the existing GUI after installation; no development watcher or replacement Web server is needed.

## Verification

Run `npm run check` with Node.js 22 or newer from this directory. Tests use synthetic credentials and a mocked native authorization flow; they do not contact OpenAI or consume quota. Installed GUI and real-account verification are separate checks.

An optional macOS integration smoke test exercises the actual adapter bundled in Desktop 0.2.1-rc.5, up to method selection, authorization URL generation and the callback prompt. It uses an in-memory credential stub and does not exchange tokens or open the browser. It may briefly bind the native loopback callback port and then cancels:

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" ./tests/native-installed.smoke.mjs
```

This is a local third-party plugin, not an official OpenAI or DeepSeek integration. Never commit credential stores, OAuth replies, redirect URLs, tokens, or personal screenshots.

## Install / remove

Clone the repository into a permanent location (the installed plugin links to this directory). Use the **bundled Desktop CLI matching the application**, not an older npm `dsh` command. Tested with macOS Desktop **0.2.1-rc.5**:

```sh
git clone https://github.com/rooty/dsh-chatgpt-oauth.git
cd dsh-chatgpt-oauth
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "$PWD"
```

No npm installation or build step is needed; browser JavaScript is prebuilt and the package has no runtime dependencies. `private: true` prevents accidental npm publication; it does not restrict this GitHub repository.

This writes the Desktop profile only. Fully quit the running application with **Cmd+Q** and reopen it so the host plugin is loaded. Installation must not modify `app.asar` or disable code signing. To uninstall:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop remove @local/dsh-chatgpt-oauth
```

No compatibility exemption is used. A future DSH upgrade may refuse this version-pinned plugin until its native authorization and slot contracts are checked again.

## Known limitations

- Compatibility is pinned to DSH **0.2.1-rc.5**; other versions are not verified.
- If another page is already signing in when this card opens, the buttons can remain disabled after that attempt finishes. Reopen Settings → Models or refresh the page to reload status.
- Automated tests do not establish subscription entitlement or actual model access. Verify those with a successful model request after signing in.
- No open-source license has been selected yet.

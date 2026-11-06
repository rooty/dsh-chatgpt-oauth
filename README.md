# Local ChatGPT OAuth for DeepSeek Harness

[English](README.md) | [Русский](README.ru.md) | [Українська](README.uk.md)

A minimal, user-owned plugin for **DSH 0.2.2-rc.1** (plugin **0.1.1**). It adds a ChatGPT sign-in card to the bottom of **Settings → Models** and invokes the installed `llm-pi-ai/openai-codex` authorization flow. It does not implement its own OAuth protocol, run Codex CLI, replace DSH's provider, or configure search/image generation.

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

Run `npm run check` with Node.js 22 or newer from this directory. The 32 deterministic tests use synthetic credentials and mocked native authorization; they do not contact OpenAI or consume quota. Existing client tests are isolated hook fixtures, not real-browser/DOM verification.

Run `npm run test:native` with the bundled Desktop Electron runtime. It uses the **actual installed** AuthorizationService, pi-ai adapter and Connection carrier. The authorization test cancels at the browser/device method-selection prompt **without answering**: no browser, callback listener, device request or token exchange starts. The Connection test verifies Desktop-shaped and same-origin Web owner admission plus hostile Host/Origin, anonymous and non-owner rejection; authentication is synthetic and no sockets are created. Network fetch is disabled in both tests. No actual credential store is instantiated or inspected.

For 0.1.1 the native contracts and Models footer were checked against installed 0.2.2-rc.1. The Host and browser implementation files are unchanged; the exact engine declaration is updated only after these checks. No broad future-version range or compatibility exemption is granted. The previous smoke that entered the browser OAuth branch has been replaced by the strictly offline selection/cancellation test. Installed GUI, token validity and real-account/model access remain separate owner checks; an update must not reauthorize or log out the user.

This is a local third-party plugin, not an official OpenAI or DeepSeek integration. Never commit credential stores, OAuth replies, redirect URLs, tokens, or personal screenshots.

## Install / remove

Clone the repository into a permanent location (the installed plugin links to this directory). Use the **bundled Desktop CLI matching the application**, not an older npm `dsh` command. Tested with macOS Desktop **0.2.2-rc.1**:

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

- Compatibility is pinned to DSH **0.2.2-rc.1**; other versions are not verified.
- If another page is already signing in when this card opens, the buttons can remain disabled after that attempt finishes. Reopen Settings → Models or refresh the page to reload status.
- Automated tests do not establish subscription entitlement or actual model access. Verify those with a successful model request after signing in.

## License

[MIT](LICENSE) © 2026 Vitalii Mikhnevych.

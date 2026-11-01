window.__ModuleLoader__.load({
  id: '@local/dsh-chatgpt-oauth',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'local.chatgptOAuth';
    const isDesktop = location.protocol === 'dsh-app:' && location.hostname === 'app';
    const en = {
      title: 'ChatGPT / Codex sign-in', description: 'Sign in to the native openai-codex provider with your ChatGPT account. No API key is needed.',
      checking: 'Checking sign-in status…', connected: 'A saved ChatGPT sign-in is available.', disconnected: 'Not signed in.', unavailable: 'The native Codex sign-in flow is not loaded. Enable the llm-pi-ai and authorization plugins.',
      login: 'Sign in with ChatGPT', cancel: 'Cancel sign-in', waiting: 'Waiting for ChatGPT sign-in…', open: 'Open ChatGPT sign-in', code: 'Verification code', submit: 'Continue',
      success: 'Sign-in saved. Open the openai-codex provider above, fetch available models if needed, and click Apply.',
      logout: 'Sign out of DSH', logoutConfirm: 'Remove the saved ChatGPT sign-in from DSH? This does not sign out of ChatGPT or Codex CLI.',
      failed: 'Sign-in failed. Try again; complete the sign-in in the browser when prompted.', cancelled: 'Sign-in cancelled.',
      network: 'Could not reach the sign-in plugin. Refresh this page and try again.', busy: 'Another sign-in is already running. Finish or cancel it first.',
      privacy: 'Tokens stay in DSH’s credential store. Signing in does not change your model, provider endpoint, search, or image settings.',
      prompt: 'Complete the requested sign-in step.', choose: 'Choose an option',
    };
    const ru = {
      title: 'Вход ChatGPT / Codex', description: 'Вход в штатный провайдер openai-codex через аккаунт ChatGPT. API-ключ не нужен.',
      checking: 'Проверка входа…', connected: 'В DSH сохранён вход через ChatGPT.', disconnected: 'Вход не выполнен.', unavailable: 'Штатный вход Codex не загружен. Включите плагины llm-pi-ai и authorization.',
      login: 'Войти через ChatGPT', cancel: 'Отменить вход', waiting: 'Ожидание входа через ChatGPT…', open: 'Открыть вход ChatGPT', code: 'Код подтверждения', submit: 'Продолжить',
      success: 'Вход сохранён. Откройте провайдер openai-codex выше, при необходимости загрузите модели и нажмите Apply.',
      logout: 'Выйти из DSH', logoutConfirm: 'Удалить сохранённый вход ChatGPT из DSH? Это не завершит сеанс ChatGPT или Codex CLI.',
      failed: 'Не удалось войти. Повторите попытку и завершите вход в браузере.', cancelled: 'Вход отменён.',
      network: 'Плагин входа недоступен. Обновите страницу и повторите попытку.', busy: 'Другой вход уже запущен. Сначала завершите или отмените его.',
      privacy: 'Токены остаются в хранилище DSH. Вход не меняет выбранную модель, адрес провайдера, поиск и настройки изображений.',
      prompt: 'Завершите запрошенный шаг входа.', choose: 'Выберите вариант',
    };
    const zh = { ...en, title: 'ChatGPT / Codex 登录', login: '使用 ChatGPT 登录', cancel: '取消登录', logout: '退出 DSH', open: '打开 ChatGPT 登录' };
    const css = `.dsh-local-codex{border:1px solid var(--dsw-alias-border-main,rgba(127,127,127,.25));border-radius:16px;padding:20px;display:grid;gap:12px;color:var(--dsw-alias-label-primary,inherit);font:inherit}.dsh-local-codex h3{font-size:16px;margin:0}.dsh-local-codex p{margin:0;font-size:13px;line-height:1.5}.dsh-local-codex small{font-size:12px;line-height:1.5;opacity:.65}.dsh-local-codex .actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.dsh-local-codex button,.dsh-local-codex input,.dsh-local-codex select{font:inherit;border:1px solid rgba(127,127,127,.4);border-radius:10px;padding:9px 14px;background:transparent;color:inherit}.dsh-local-codex button{cursor:pointer}.dsh-local-codex button.primary{background:var(--dsw-alias-label-primary,#ddd);color:var(--dsw-alias-background-primary,#191919);border-color:transparent}.dsh-local-codex button:disabled{opacity:.45;cursor:default}.dsh-local-codex button:focus-visible,.dsh-local-codex input:focus-visible,.dsh-local-codex select:focus-visible,.dsh-local-codex a:focus-visible{outline:2px solid currentColor;outline-offset:3px}.dsh-local-codex a{color:var(--dsw-alias-link,#739dff)}.dsh-local-codex form{display:grid;gap:10px}.dsh-local-codex input,.dsh-local-codex select{width:100%;box-sizing:border-box}.dsh-local-codex .error{color:var(--dsw-alias-label-error,#ec7777)}.dsh-local-codex .notice{display:grid;gap:8px;overflow-wrap:anywhere}`;

    function allowedAuthUrl(raw) {
      try {
        const url = new URL(raw);
        return url.protocol === 'https:' && !url.username && !url.password &&
          ['auth.openai.com', 'auth0.openai.com', 'chatgpt.com', 'platform.openai.com', 'www.openai.com', 'openai.com'].includes(url.hostname) ? url.href : null;
      } catch { return null; }
    }
    async function api(method, payload = {}, keepalive = false) {
      const url = new URL(`api/local-chatgpt-oauth/${method}`, document.baseURI);
      // Electron uses a privileged custom scheme; its serialized origin differs
      // between URL implementations. Bind to the exact native scheme/host instead.
      const trusted = isDesktop
        ? url.protocol === 'dsh-app:' && url.host === 'app'
        : url.origin === location.origin;
      if (!trusted || url.username || url.password) throw new Error('UNTRUSTED_BASE');
      const response = await fetch(url, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive,
        headers: { 'Content-Type': 'application/json', 'X-DSH-Codex-OAuth': '1' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error?.code || 'REQUEST_FAILED');
      return result;
    }

    function Card({ t }) {
      const [status, setStatus] = React.useState(null);
      const [attempt, setAttempt] = React.useState(null);
      const [message, setMessage] = React.useState('');
      const [error, setError] = React.useState('');
      const [pending, setPending] = React.useState(false);
      const [value, setValue] = React.useState('');
      const live = React.useRef(true);
      const actionBusy = React.useRef(false);
      const attemptId = React.useRef(null);
      const popup = React.useRef(null);
      const openedUrl = React.useRef(null);
      const fail = (err) => {
        if (live.current) setError(t(err?.message === 'BUSY' ? 'busy' : 'network'));
      };
      const refresh = async () => {
        const result = await api('status');
        if (live.current) setStatus(result);
      };
      React.useEffect(() => {
        live.current = true;
        refresh().catch(fail);
        return () => {
          live.current = false;
          if (attemptId.current) api('cancel', { attemptId: attemptId.current }, true).catch(() => {});
          if (popup.current && !openedUrl.current) popup.current.close();
        };
      }, []);
      React.useEffect(() => { setValue(''); }, [attempt?.prompt?.id]);
      React.useEffect(() => {
        if (!attempt?.attemptId) return;
        let disposed = false;
        let timer;
        const poll = async () => {
          try {
            const result = await api('poll', { attemptId: attempt.attemptId });
            if (disposed || !live.current) return;
            if (result.state === 'running') {
              setAttempt({ ...result, attemptId: attempt.attemptId });
              const url = result.notices.map((notice) => allowedAuthUrl(notice.url)).find(Boolean);
              if (url && !openedUrl.current) {
                if (isDesktop) {
                  // Desktop denies about:blank popups but opens HTTPS targets in
                  // the user's browser. Attempt this only once per sign-in.
                  openedUrl.current = url;
                  window.open(url, '_blank', 'noopener,noreferrer');
                } else if (popup.current && !popup.current.closed) {
                  openedUrl.current = url;
                  popup.current.location = url;
                }
              }
              timer = setTimeout(poll, 1000);
            } else {
              attemptId.current = null;
              setAttempt(null);
              if (popup.current && !openedUrl.current) popup.current.close();
              if (result.state === 'authorized') {
                setMessage(t('success'));
                await refresh();
              } else if (result.state === 'cancelled') setMessage(t('cancelled'));
              else setError(t('failed'));
            }
          } catch (err) {
            if (disposed || !live.current) return;
            const id = attemptId.current;
            attemptId.current = null;
            setAttempt(null);
            if (id) api('cancel', { attemptId: id }).catch(() => {});
            if (popup.current && !openedUrl.current) popup.current.close();
            fail(err);
          }
        };
        poll();
        return () => { disposed = true; clearTimeout(timer); };
      }, [attempt?.attemptId]);
      const login = async () => {
        if (actionBusy.current || attemptId.current) return;
        actionBusy.current = true;
        setPending(true); setError(''); setMessage('');
        openedUrl.current = null;
        popup.current = isDesktop ? null : window.open('about:blank', '_blank');
        if (popup.current) popup.current.opener = null;
        try {
          const result = await api('start');
          if (!live.current) {
            await api('cancel', { attemptId: result.attemptId });
            return;
          }
          attemptId.current = result.attemptId;
          setAttempt({ attemptId: result.attemptId, state: 'running', notices: [], prompt: null });
        } catch (err) {
          if (popup.current && !openedUrl.current) popup.current.close();
          fail(err);
        } finally { actionBusy.current = false; if (live.current) setPending(false); }
      };
      const cancel = async () => {
        if (actionBusy.current || !attemptId.current) return;
        actionBusy.current = true;
        setPending(true);
        try {
          await api('cancel', { attemptId: attemptId.current });
          attemptId.current = null;
          if (live.current) { setAttempt(null); setMessage(t('cancelled')); }
          if (popup.current && !openedUrl.current) popup.current.close();
        } catch (err) { fail(err); }
        finally { actionBusy.current = false; if (live.current) setPending(false); }
      };
      const reply = async (event) => {
        event.preventDefault();
        if (actionBusy.current || !attemptId.current || !attempt?.prompt) return;
        actionBusy.current = true;
        setPending(true); setError('');
        try {
          await api('reply', { attemptId: attemptId.current, promptId: attempt.prompt.id, value });
          if (live.current) { setValue(''); setAttempt((current) => current ? { ...current, prompt: null } : null); }
        } catch (err) { fail(err); }
        finally { actionBusy.current = false; if (live.current) setPending(false); }
      };
      const logout = async () => {
        if (actionBusy.current || attemptId.current || !window.confirm(t('logoutConfirm'))) return;
        actionBusy.current = true;
        setPending(true); setError(''); setMessage('');
        try { await api('logout'); await refresh(); }
        catch (err) { fail(err); }
        finally { actionBusy.current = false; if (live.current) setPending(false); }
      };
      return h('section', { className: 'dsh-local-codex', 'aria-label': t('title') },
        h('style', null, css),
        h('h3', null, t('title')),
        h('p', null, t('description')),
        h('p', { role: 'status', 'aria-live': 'polite' }, status ? t(status.configured ? 'connected' : status.available ? 'disconnected' : 'unavailable') : t('checking')),
        h('div', { className: 'actions' }, attempt
          ? h('button', { type: 'button', disabled: pending, onClick: cancel }, t('cancel'))
          : h('button', { type: 'button', className: 'primary', disabled: pending || !status?.available || status.inFlight, onClick: login }, t('login')),
          status?.configured && !attempt && h('button', { type: 'button', disabled: pending || status.inFlight, onClick: logout }, t('logout'))),
        attempt && h('div', { className: 'notice', role: 'status' },
          h('p', null, t('waiting')),
          attempt.notices.map((notice, index) => {
            const url = allowedAuthUrl(notice.url);
            return h('div', { key: index },
              notice.message && h('p', null, notice.message),
              url && h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', referrerPolicy: 'no-referrer' }, t('open')),
              notice.code && h('p', null, t('code'), ': ', h('code', null, notice.code)));
          })),
        attempt?.prompt && h('form', { onSubmit: reply },
          h('label', { htmlFor: 'dsh-codex-oauth-reply' }, attempt.prompt.message || t('prompt')),
          attempt.prompt.kind === 'select'
            ? h('select', { id: 'dsh-codex-oauth-reply', required: true, value, onChange: (event) => setValue(event.target.value), disabled: pending },
              h('option', { value: '', disabled: true }, t('choose')),
              attempt.prompt.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)))
            : h('input', { id: 'dsh-codex-oauth-reply', type: attempt.prompt.kind === 'secret' ? 'password' : 'text', value,
              onChange: (event) => setValue(event.target.value), placeholder: attempt.prompt.placeholder || '', autoComplete: 'off', spellCheck: false, required: true, disabled: pending }),
          h('div', { className: 'actions' }, h('button', { type: 'submit', disabled: pending || value.length === 0 }, t('submit')))),
        message && h('p', { role: 'status' }, message),
        error && h('p', { role: 'alert', className: 'error' }, error),
        h('small', null, t('privacy')));
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en, ru, zh }), 'local-chatgpt-oauth: locale');
        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
          name: 'settings.models.footer', id: 'local-chatgpt-oauth', order: 10, inject: () => ({ t }),
        }, Card));
      },
    };
  },
});

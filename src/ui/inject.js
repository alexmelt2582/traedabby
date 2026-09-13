(() => {
  "use strict";

  const ROOT_ID = "trae-enhancer-root";
  const STYLE_ID = "trae-enhancer-style";
  const API_BASE = "__API_BASE__";
  const API_TOKEN = "__API_TOKEN__";

  window.__traeEnhancerCleanup?.();
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID} {
      --te-panel: color-mix(in srgb, var(--vscode-editor-background, #ffffff) 94%, transparent);
      --te-panel-solid: var(--vscode-editor-background, #ffffff);
      --te-surface: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, #f6f6f6));
      --te-surface-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,.12));
      --te-border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.24)));
      --te-text: var(--vscode-foreground, #1f1f1f);
      --te-muted: var(--vscode-descriptionForeground, #777777);
      --te-accent: var(--vscode-button-background, #2f6fd6);
      --te-accent-fg: var(--vscode-button-foreground, #ffffff);
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483646;
      color: var(--te-text);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: 12px;
      line-height: 1.4;
    }

    #${ROOT_ID} *,
    #${ROOT_ID} *::before,
    #${ROOT_ID} *::after { box-sizing: border-box; }

    #${ROOT_ID} .te-fab {
      width: 42px;
      height: 42px;
      margin-left: auto;
      display: grid;
      place-items: center;
      border: 1px solid var(--te-border);
      border-radius: 12px;
      color: var(--te-text);
      background: var(--te-panel);
      box-shadow: 0 8px 26px rgba(0,0,0,.22);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      cursor: pointer;
      transition: background .15s, box-shadow .15s, transform .15s;
    }

    #${ROOT_ID} .te-fab:hover {
      background: var(--te-surface-hover);
      box-shadow: 0 10px 30px rgba(0,0,0,.28);
      transform: translateY(-1px);
    }

    #${ROOT_ID} .te-panel {
      position: absolute;
      right: 0;
      bottom: 50px;
      width: min(440px, calc(100vw - 24px));
      max-height: min(640px, calc(100vh - 84px));
      display: none;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--te-border);
      border-radius: 14px;
      background: var(--te-panel);
      box-shadow: 0 20px 60px rgba(0,0,0,.34);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }

    #${ROOT_ID} .te-panel.open { display: flex; }

    #${ROOT_ID} .te-header {
      min-height: 52px;
      padding: 0 12px 0 15px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--te-border);
      flex: 0 0 auto;
    }

    #${ROOT_ID} .te-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-subtitle {
      margin-left: auto;
      color: var(--te-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    #${ROOT_ID} .te-icon-btn {
      width: 30px;
      height: 30px;
      display: inline-grid;
      place-items: center;
      flex: 0 0 30px;
      border: 0;
      border-radius: 8px;
      color: var(--te-muted);
      background: transparent;
      cursor: pointer;
    }

    #${ROOT_ID} .te-icon-btn:hover {
      color: var(--te-text);
      background: var(--te-surface-hover);
    }

    #${ROOT_ID} .te-body {
      min-height: 0;
      overflow: auto;
      padding: 12px;
    }

    #${ROOT_ID} .te-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    #${ROOT_ID} .te-primary,
    #${ROOT_ID} .te-secondary {
      height: 32px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border-radius: 9px;
      padding: 0 11px;
      border: 1px solid transparent;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    #${ROOT_ID} .te-primary {
      color: var(--te-accent-fg);
      background: var(--te-accent);
    }

    #${ROOT_ID} .te-secondary {
      margin-left: auto;
      color: var(--te-text);
      border-color: var(--te-border);
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-primary:hover,
    #${ROOT_ID} .te-secondary:hover { filter: brightness(1.06); }

    #${ROOT_ID} button:disabled {
      opacity: .52;
      cursor: not-allowed;
      transform: none !important;
    }

    #${ROOT_ID} .te-list {
      display: grid;
      gap: 8px;
    }

    #${ROOT_ID} .te-card {
      min-height: 68px;
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--te-border);
      border-radius: 10px;
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-avatar {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 9px;
      color: var(--te-accent-fg);
      background: var(--te-accent);
      font-weight: 700;
      user-select: none;
    }

    #${ROOT_ID} .te-account-main { min-width: 0; }

    #${ROOT_ID} .te-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-meta {
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--te-muted);
      font-size: 11px;
    }

    #${ROOT_ID} .te-time {
      max-width: 92px;
      color: var(--te-muted);
      font-size: 10px;
      text-align: right;
    }

    #${ROOT_ID} .te-empty {
      padding: 30px 18px;
      text-align: center;
      color: var(--te-muted);
      border: 1px dashed var(--te-border);
      border-radius: 10px;
    }

    #${ROOT_ID} .te-footer {
      min-height: 34px;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 12px;
      border-top: 1px solid var(--te-border);
      color: var(--te-muted);
      font-size: 10px;
      flex: 0 0 auto;
    }

    #${ROOT_ID} .te-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #ef4444;
    }

    #${ROOT_ID} .te-dot.online { background: #22a06b; }

    #${ROOT_ID} .te-toast {
      position: absolute;
      right: 8px;
      bottom: 42px;
      max-width: calc(100% - 16px);
      padding: 8px 10px;
      border: 1px solid var(--te-border);
      border-radius: 9px;
      color: var(--te-text);
      background: var(--te-panel-solid);
      box-shadow: 0 8px 24px rgba(0,0,0,.24);
      opacity: 0;
      pointer-events: none;
      transform: translateY(5px);
      transition: opacity .16s, transform .16s;
    }

    #${ROOT_ID} .te-toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    #${ROOT_ID} .te-spinner {
      width: 13px;
      height: 13px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: te-spin .7s linear infinite;
    }

    @keyframes te-spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      #${ROOT_ID} { right: 12px; bottom: 12px; }
      #${ROOT_ID} .te-panel { bottom: 50px; }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = ROOT_ID;

  const panel = document.createElement("section");
  panel.className = "te-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "增强助手");

  const header = document.createElement("div");
  header.className = "te-header";
  header.innerHTML = `
    <div class="te-title">增强助手</div>
    <div class="te-subtitle">账号</div>
    <button class="te-icon-btn te-close" type="button" title="关闭" aria-label="关闭">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    </button>
  `;

  const body = document.createElement("div");
  body.className = "te-body";

  const toolbar = document.createElement("div");
  toolbar.className = "te-toolbar";
  toolbar.innerHTML = `
    <button class="te-primary te-backup" type="button">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <path d="M17 21v-8H7v8M7 3v5h8"/>
      </svg>
      <span>备份当前账号</span>
    </button>
    <button class="te-secondary te-refresh" type="button" title="刷新" aria-label="刷新">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>
      </svg>
    </button>
  `;

  const list = document.createElement("div");
  list.className = "te-list";

  body.append(toolbar, list);

  const footer = document.createElement("div");
  footer.className = "te-footer";
  footer.innerHTML = '<span class="te-dot"></span><span class="te-status">连接中</span>';

  const toast = document.createElement("div");
  toast.className = "te-toast";

  panel.append(header, body, footer, toast);

  const fab = document.createElement("button");
  fab.className = "te-fab";
  fab.type = "button";
  fab.title = "增强助手";
  fab.setAttribute("aria-label", "打开增强助手");
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="7" width="16" height="12" rx="3"/>
      <path d="M9 12h.01M15 12h.01M9 16h6M12 7V4M9 4h6"/>
    </svg>
  `;

  root.append(panel, fab);
  document.body.appendChild(root);

  let toastTimer = null;
  let refreshGeneration = 0;

  function api(path, options = {}) {
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-trae-enhancer-token": API_TOKEN,
        ...(options.headers || {}),
      },
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    });
  }

  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.style.color = error ? "#ef4444" : "";
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function formatTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function accountMeta(account) {
    return account.maskedEmail || account.maskedUserId || "已保存认证";
  }

  function renderAccounts(accounts) {
    list.replaceChildren();
    if (!accounts.length) {
      const empty = document.createElement("div");
      empty.className = "te-empty";
      empty.textContent = "暂无账号备份";
      list.appendChild(empty);
      return;
    }

    for (const account of accounts) {
      const card = document.createElement("article");
      card.className = "te-card";

      const avatar = document.createElement("div");
      avatar.className = "te-avatar";
      avatar.textContent = (account.displayName || "T").trim().slice(0, 1).toUpperCase();

      const main = document.createElement("div");
      main.className = "te-account-main";
      const name = document.createElement("div");
      name.className = "te-name";
      name.textContent = account.displayName || "TRAE account";
      const meta = document.createElement("div");
      meta.className = "te-meta";
      meta.textContent = accountMeta(account);
      main.append(name, meta);

      const time = document.createElement("div");
      time.className = "te-time";
      time.textContent = formatTime(account.updatedAt);

      card.append(avatar, main, time);
      list.appendChild(card);
    }
  }

  async function refresh() {
    const generation = ++refreshGeneration;
    const refreshButton = toolbar.querySelector(".te-refresh");
    refreshButton.disabled = true;
    try {
      const [health, data] = await Promise.all([api("/api/health"), api("/api/accounts")]);
      if (generation !== refreshGeneration) return;
      const status = footer.querySelector(".te-status");
      const dot = footer.querySelector(".te-dot");
      dot.classList.toggle("online", !!health.cdpConnected);
      status.textContent = health.cdpConnected ? "CDP 已连接" : "等待 CDP";
      header.querySelector(".te-subtitle").textContent = `账号 ${data.accounts.length}`;
      renderAccounts(data.accounts);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      const status = footer.querySelector(".te-status");
      footer.querySelector(".te-dot").classList.remove("online");
      status.textContent = "服务不可用";
      showToast(error.message || String(error), true);
    } finally {
      refreshButton.disabled = false;
    }
  }

  async function backupCurrent() {
    const button = toolbar.querySelector(".te-backup");
    const label = button.querySelector("span");
    const original = label.textContent;
    button.disabled = true;
    label.textContent = "备份中";
    try {
      const result = await api("/api/accounts/backup", {
        method: "POST",
        body: "{}",
      });
      showToast(result.createdSnapshot ? "已保存当前账号" : "账号备份已更新");
      await refresh();
    } catch (error) {
      showToast(error.message || String(error), true);
    } finally {
      button.disabled = false;
      label.textContent = original;
    }
  }

  function openPanel() {
    panel.classList.add("open");
    refresh().catch(() => {});
  }

  function closePanel() {
    panel.classList.remove("open");
  }

  fab.addEventListener("click", () => {
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  });
  header.querySelector(".te-close").addEventListener("click", closePanel);
  toolbar.querySelector(".te-refresh").addEventListener("click", () => refresh());
  toolbar.querySelector(".te-backup").addEventListener("click", backupCurrent);

  window.__traeEnhancerCleanup = () => {
    clearTimeout(toastTimer);
    root.remove();
    style.remove();
    delete window.__traeEnhancerCleanup;
  };
})();


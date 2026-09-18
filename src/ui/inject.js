(() => {
  "use strict";

  const ROOT_ID = "trae-enhancer-root";
  const STYLE_ID = "trae-enhancer-style";
  const API_BASE = "__API_BASE__";
  const API_TOKEN = "__API_TOKEN__";
  const APP_VERSION = "__APP_VERSION__";
  // Dispatched by the daemon through CDP after any account state change. The
  // panel is a pure view, so this is how a background sweep reaches an already
  // open panel without a polling loop on this side.
  const ACCOUNTS_UPDATED_EVENT = "trae-enhancer:accounts-updated";

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

    #${ROOT_ID} [hidden] { display: none !important; }

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
      width: min(460px, calc(100vw - 24px));
      height: min(700px, calc(100vh - 84px));
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

    #${ROOT_ID} .te-tabs {
      display: flex;
      gap: 6px;
      padding: 9px 12px 0;
      border-bottom: 1px solid var(--te-border);
      flex: 0 0 auto;
    }

    #${ROOT_ID} .te-tab {
      min-width: 88px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 12px;
      border: 0;
      border-radius: 9px 9px 0 0;
      color: var(--te-muted);
      background: transparent;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }

    #${ROOT_ID} .te-tab:hover {
      color: var(--te-text);
      background: var(--te-surface-hover);
    }

    #${ROOT_ID} .te-tab.active {
      color: var(--te-accent-fg);
      background: var(--te-accent);
    }

    #${ROOT_ID} .te-content {
      min-height: 0;
      overflow: hidden;
      flex: 1 1 auto;
    }

    #${ROOT_ID} .te-pane {
      display: none;
      height: 100%;
      min-height: 0;
    }

    #${ROOT_ID} .te-pane.active {
      display: flex;
      flex-direction: column;
    }

    #${ROOT_ID} .te-pane[data-pane="about"] {
      overflow: auto;
      padding: 12px;
    }

    #${ROOT_ID} .te-pane[data-pane="settings"] {
      overflow: auto;
      padding: 12px;
    }

    #${ROOT_ID} .te-settings {
      display: grid;
      gap: 12px;
    }

    #${ROOT_ID} .te-section {
      padding: 12px;
      border: 1px solid var(--te-border);
      border-radius: 11px;
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-section-hint {
      margin-top: 6px;
      color: var(--te-muted);
      font-size: 11px;
    }

    #${ROOT_ID} .te-select {
      width: 100%;
      height: 34px;
      margin-top: 10px;
      padding: 0 8px;
      border: 1px solid var(--te-border);
      border-radius: 8px;
      outline: 0;
      color: var(--te-text);
      background: var(--te-panel-solid);
      font: inherit;
    }

    #${ROOT_ID} .te-select:focus {
      border-color: var(--te-accent);
      box-shadow: 0 0 0 1px var(--te-accent);
    }

    #${ROOT_ID} .te-status-list {
      display: grid;
      gap: 4px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--te-border);
      color: var(--te-muted);
      font-size: 11px;
    }

    #${ROOT_ID} .te-status-line {
      display: flex;
      gap: 6px;
    }

    #${ROOT_ID} .te-status-line > b {
      flex: 0 0 auto;
      color: var(--te-text);
      font-weight: 650;
    }

    #${ROOT_ID} .te-status-line > span {
      min-width: 0;
      word-break: break-word;
    }

    #${ROOT_ID} .te-badge {
      padding: 1px 7px;
      border: 1px solid var(--te-border);
      border-radius: 999px;
      color: var(--te-muted);
      font-size: 10px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-badge.ok { color: #16a34a; border-color: #16a34a66; }
    #${ROOT_ID} .te-badge.warn { color: #d97706; border-color: #d9770666; }

    #${ROOT_ID} .te-section-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    #${ROOT_ID} .te-restart-banner {
      display: none;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      padding: 8px 10px;
      border: 1px solid var(--te-accent);
      border-radius: 9px;
      background: color-mix(in srgb, var(--te-accent) 12%, transparent);
      font-size: 11px;
    }

    #${ROOT_ID} .te-restart-banner.show { display: flex; }
    #${ROOT_ID} .te-restart-banner button { margin-left: auto; flex: 0 0 auto; }

    /* The section cards already use the surface colour, so the controls inside
       them need the solid panel colour to stay distinguishable. */
    #${ROOT_ID} .te-pane[data-pane="settings"] .te-secondary,
    #${ROOT_ID} .te-pane[data-pane="settings"] .te-field input {
      background: var(--te-panel-solid);
    }

    #${ROOT_ID} .te-about {
      display: grid;
      gap: 14px;
    }

    #${ROOT_ID} .te-about-hero {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      padding: 14px;
      border: 1px solid var(--te-border);
      border-radius: 11px;
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-about-icon {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border-radius: 11px;
      color: var(--te-accent-fg);
      background: var(--te-accent);
    }

    #${ROOT_ID} .te-about-name {
      font-size: 15px;
      font-weight: 750;
    }

    #${ROOT_ID} .te-about-summary {
      margin-top: 4px;
      color: var(--te-muted);
      font-size: 11px;
      line-height: 1.55;
    }

    #${ROOT_ID} .te-about-version {
      display: inline-flex;
      margin-top: 7px;
      padding: 3px 7px;
      border-radius: 999px;
      color: var(--te-accent);
      background: color-mix(in srgb, var(--te-accent) 12%, transparent);
      font-size: 10px;
      font-weight: 700;
    }

    #${ROOT_ID} .te-feature-list {
      display: grid;
      gap: 7px;
    }

    #${ROOT_ID} .te-feature {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 9px 10px;
      border: 1px solid var(--te-border);
      border-radius: 9px;
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-feature-icon {
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      color: var(--te-accent);
      background: color-mix(in srgb, var(--te-accent) 10%, transparent);
    }

    #${ROOT_ID} .te-feature-title {
      display: block;
      font-size: 12px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-feature-desc {
      display: block;
      margin-top: 2px;
      color: var(--te-muted);
      font-size: 10.5px;
      line-height: 1.45;
    }

    #${ROOT_ID} .te-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--te-border);
      background: color-mix(in srgb, var(--te-surface) 58%, transparent);
      flex: 0 0 auto;
    }

    #${ROOT_ID} .te-toolbar-summary {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--te-muted);
      font-size: 11px;
      white-space: nowrap;
    }

    #${ROOT_ID} .te-toolbar-stat strong {
      margin-left: 3px;
      color: var(--te-text);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    #${ROOT_ID} .te-toolbar-actions {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 6px;
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
      color: var(--te-text);
      border-color: var(--te-border);
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-account-io {
      width: 32px;
      padding: 0;
      flex: 0 0 32px;
    }

    #${ROOT_ID} .te-primary:hover,
    #${ROOT_ID} .te-secondary:hover { filter: brightness(1.06); }

    #${ROOT_ID} button:disabled {
      opacity: .52;
      cursor: not-allowed;
      transform: none !important;
    }

    #${ROOT_ID} .te-list {
      min-height: 0;
      display: grid;
      gap: 8px;
      overflow: auto;
      padding: 10px 12px;
      flex: 1 1 auto;
      align-content: start;
    }

    #${ROOT_ID} .te-card {
      display: block;
      padding: 12px;
      border: 1px solid var(--te-border);
      border-radius: 10px;
      background: var(--te-surface);
    }

    #${ROOT_ID} .te-card.current {
      border-color: color-mix(in srgb, #22a06b 42%, var(--te-border));
      box-shadow: inset 3px 0 0 #22a06b;
    }

    #${ROOT_ID} .te-account-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    #${ROOT_ID} .te-account-main {
      min-width: 0;
      flex: 1 1 auto;
    }

    #${ROOT_ID} .te-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-account-ops {
      display: flex;
      align-items: center;
      gap: 5px;
      flex: 0 0 auto;
    }

    #${ROOT_ID} .te-meta-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 13px;
      min-width: 0;
      margin-top: 8px;
      color: var(--te-muted);
      font-size: 10.5px;
    }

    #${ROOT_ID} .te-meta-item {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    #${ROOT_ID} .te-meta-label {
      color: var(--te-muted);
      flex: 0 0 auto;
    }

    #${ROOT_ID} .te-meta-value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--te-text);
      font-weight: 600;
    }

    #${ROOT_ID} .te-checkin-state.checked {
      color: #22a06b;
    }

    #${ROOT_ID} .te-keepalive-state.checked {
      color: #22a06b;
    }

    #${ROOT_ID} .te-checkin-state.error {
      color: #ef4444;
    }

    #${ROOT_ID} .te-keepalive-state.error {
      color: #ef4444;
    }

    #${ROOT_ID} .te-keepalive-state.warning {
      color: #f59e0b;
    }

    #${ROOT_ID} .te-transfer-note {
      margin: 0 0 12px;
      padding: 10px 12px;
      border: 1px solid var(--te-border);
      border-left: 3px solid var(--te-accent);
      border-radius: 6px;
      background: var(--te-surface);
      color: var(--te-muted);
      font-size: 12px;
      line-height: 1.6;
    }

    #${ROOT_ID} .te-checkin-state.pending {
      color: var(--te-muted);
    }

    #${ROOT_ID} .te-keepalive-state.pending {
      color: var(--te-muted);
    }

    #${ROOT_ID} .te-credit-block {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-top: 9px;
      padding-top: 9px;
      border-top: 1px solid color-mix(in srgb, var(--te-border) 80%, transparent);
    }

    #${ROOT_ID} .te-credit-label {
      color: var(--te-muted);
      font-size: 10px;
    }

    #${ROOT_ID} .te-credit-value {
      color: var(--te-accent);
      font-size: 15px;
      font-weight: 750;
      font-variant-numeric: tabular-nums;
    }

    #${ROOT_ID} .te-credit-detail {
      min-width: 0;
      margin-left: auto;
      overflow: hidden;
      color: var(--te-muted);
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${ROOT_ID} .te-current {
      padding: 3px 7px;
      border-radius: 999px;
      color: #22a06b;
      background: color-mix(in srgb, #22a06b 13%, transparent);
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }

    #${ROOT_ID} .te-empty {
      padding: 30px 18px;
      text-align: center;
      color: var(--te-muted);
      border: 1px dashed var(--te-border);
      border-radius: 10px;
    }

    /* Sits on its own line under the failure message instead of running on. */
    #${ROOT_ID} .te-empty .te-adopt-retry {
      display: block;
      margin: 12px auto 0;
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

    #${ROOT_ID} .te-modal-mask {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: none;
      place-items: center;
      padding: 16px;
      background: rgba(0,0,0,.38);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    }

    #${ROOT_ID} .te-modal-mask.open { display: grid; }

    #${ROOT_ID} .te-modal {
      width: min(360px, calc(100vw - 32px));
      padding: 18px;
      border: 1px solid var(--te-border);
      border-radius: 12px;
      color: var(--te-text);
      background: var(--te-panel-solid);
      box-shadow: 0 22px 70px rgba(0,0,0,.38);
    }

    #${ROOT_ID} .te-modal-title {
      font-size: 15px;
      font-weight: 700;
    }

    #${ROOT_ID} .te-modal-status {
      min-height: 42px;
      margin-top: 10px;
      color: var(--te-muted);
      font-size: 12px;
      line-height: 1.6;
    }

    #${ROOT_ID} .te-login-options {
      display: grid;
      gap: 9px;
      margin-top: 14px;
    }

    #${ROOT_ID} .te-login-option {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--te-border);
      border-radius: 10px;
      background: var(--te-surface);
      cursor: pointer;
    }

    #${ROOT_ID} .te-login-option.selected {
      border-color: var(--te-accent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--te-accent) 42%, transparent);
    }

    #${ROOT_ID} .te-login-option input {
      width: 16px;
      height: 16px;
      flex: 0 0 16px;
      margin: 2px 0 0;
      accent-color: var(--te-accent);
      cursor: pointer;
    }

    #${ROOT_ID} .te-login-option-copy {
      min-width: 0;
    }

    #${ROOT_ID} .te-login-option-title {
      display: block;
      font-size: 13px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-login-option-desc {
      display: block;
      margin-top: 4px;
      color: var(--te-muted);
      font-size: 11px;
      line-height: 1.55;
    }

    #${ROOT_ID} .te-transfer-select-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 14px;
      color: var(--te-muted);
      font-size: 11px;
    }

    #${ROOT_ID} .te-transfer-toggle {
      border: 0;
      color: var(--te-accent);
      background: transparent;
      font: inherit;
      cursor: pointer;
    }

    #${ROOT_ID} .te-transfer-options {
      max-height: 168px;
      display: grid;
      gap: 6px;
      margin-top: 8px;
      overflow: auto;
    }

    #${ROOT_ID} .te-transfer-option {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 8px 9px;
      border: 1px solid var(--te-border);
      border-radius: 9px;
      background: var(--te-surface);
      cursor: pointer;
    }

    #${ROOT_ID} .te-transfer-option.selected {
      border-color: var(--te-accent);
    }

    #${ROOT_ID} .te-transfer-option input {
      width: 15px;
      height: 15px;
      flex: 0 0 15px;
      accent-color: var(--te-accent);
    }

    #${ROOT_ID} .te-transfer-option-copy { min-width: 0; }

    #${ROOT_ID} .te-transfer-option-name {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 650;
    }

    #${ROOT_ID} .te-transfer-option-meta {
      display: block;
      margin-top: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--te-muted);
      font-size: 10px;
    }

    #${ROOT_ID} .te-field {
      display: grid;
      gap: 6px;
      margin-top: 12px;
      color: var(--te-muted);
      font-size: 11px;
    }

    #${ROOT_ID} .te-field input {
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 1px solid var(--te-border);
      border-radius: 8px;
      outline: 0;
      color: var(--te-text);
      background: var(--te-surface);
      font: inherit;
    }

    #${ROOT_ID} .te-field input:focus {
      border-color: var(--te-accent);
      box-shadow: 0 0 0 1px var(--te-accent);
    }

    #${ROOT_ID} .te-transfer-file {
      margin-top: 12px;
      padding: 9px 10px;
      overflow: hidden;
      border: 1px solid var(--te-border);
      border-radius: 8px;
      background: var(--te-surface);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    #${ROOT_ID} .te-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
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

    /* Settings keep the existing panel skin, but use an internal index so the
       controls are no longer one long stack. */
    #${ROOT_ID} .te-pane[data-pane="settings"] {
      overflow: hidden;
      padding: 0;
    }

    #${ROOT_ID} .te-settings-shell {
      display: grid;
      grid-template-columns: 108px minmax(0, 1fr);
      height: 100%;
      min-height: 0;
    }

    #${ROOT_ID} .te-settings-nav {
      display: grid;
      align-content: start;
      gap: 4px;
      padding: 12px 8px;
      border-right: 1px solid var(--te-border);
      background: color-mix(in srgb, var(--te-surface) 72%, transparent);
    }

    #${ROOT_ID} .te-settings-nav-item {
      min-height: 34px;
      padding: 0 9px;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--te-muted);
      background: transparent;
      font: inherit;
      font-size: 11px;
      font-weight: 650;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }

    #${ROOT_ID} .te-settings-nav-item.active {
      border-color: var(--te-border);
      color: var(--te-text);
      background: var(--te-panel-solid);
    }

    #${ROOT_ID} .te-settings-panels {
      min-width: 0;
      overflow: auto;
      padding: 12px;
    }

    #${ROOT_ID} .te-settings-panel { display: none; }
    #${ROOT_ID} .te-settings-panel.active { display: grid; gap: 12px; }

    #${ROOT_ID} .te-settings-panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    #${ROOT_ID} .te-settings-panel-head h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
    }

    #${ROOT_ID} .te-settings-panel-head p {
      margin: 4px 0 0;
      color: var(--te-muted);
      font-size: 10.5px;
      line-height: 1.5;
    }

    #${ROOT_ID} .te-settings-panel .te-section {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    #${ROOT_ID} .te-danger {
      min-height: 32px;
      padding: 0 11px;
      border: 1px solid #ef4444;
      border-radius: 8px;
      color: #ffffff;
      background: #ef4444;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }

    #${ROOT_ID} .te-danger:disabled { opacity: .5; }
    #${ROOT_ID} .te-acc-delete:hover { color: #ef4444; }

    /* About is now a short user guide, but keeps the original panel skin. */
    #${ROOT_ID} .te-help { display: grid; gap: 16px; }
    #${ROOT_ID} .te-help-intro { display: grid; gap: 6px; }
    #${ROOT_ID} .te-help-kicker {
      color: var(--te-accent);
      font-size: 10px;
      font-weight: 700;
    }
    #${ROOT_ID} .te-help h2, #${ROOT_ID} .te-help h3 { margin: 0; }
    #${ROOT_ID} .te-help h2 { font-size: 20px; line-height: 1.2; }
    #${ROOT_ID} .te-help-intro p,
    #${ROOT_ID} .te-help-step p,
    #${ROOT_ID} .te-help-note-wrap p,
    #${ROOT_ID} .te-help-details p {
      margin: 4px 0 0;
      color: var(--te-muted);
      font-size: 11px;
      line-height: 1.6;
    }
    #${ROOT_ID} .te-help-steps { display: grid; gap: 0; }
    #${ROOT_ID} .te-help-step {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 9px;
      padding: 11px 0;
      border-top: 1px solid var(--te-border);
    }
    #${ROOT_ID} .te-help-step:last-child { border-bottom: 1px solid var(--te-border); }
    #${ROOT_ID} .te-help-step-num { color: var(--te-accent); font-weight: 750; }
    #${ROOT_ID} .te-help h3 { font-size: 12px; }
    #${ROOT_ID} .te-help-note-wrap {
      padding: 11px 12px;
      border: 1px solid var(--te-border);
      border-radius: 9px;
      background: var(--te-surface);
    }
    #${ROOT_ID} .te-help-note-wrap strong { font-size: 12px; }
    #${ROOT_ID} .te-help-details summary { color: var(--te-text); font-size: 12px; font-weight: 650; cursor: pointer; }
    #${ROOT_ID} .te-help-version { color: var(--te-muted); font-size: 10px; }

    @media (max-width: 420px) {
      #${ROOT_ID} .te-settings-shell { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
      #${ROOT_ID} .te-settings-nav {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        border-right: 0;
        border-bottom: 1px solid var(--te-border);
        padding: 8px;
      }
      #${ROOT_ID} .te-settings-nav-item { padding: 0 4px; text-align: center; }
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

  const tabs = document.createElement("div");
  tabs.className = "te-tabs";
  tabs.innerHTML = `
    <button class="te-tab active" type="button" data-tab="account">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
      <span>账号</span>
    </button>
    <button class="te-tab" type="button" data-tab="settings">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.02z"/>
      </svg>
      <span>设置</span>
    </button>
    <button class="te-tab" type="button" data-tab="about">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4M12 8h.01"/>
      </svg>
      <span>关于</span>
    </button>
  `;

  const content = document.createElement("div");
  content.className = "te-content";

  const accountPane = document.createElement("div");
  accountPane.className = "te-pane active";
  accountPane.dataset.pane = "account";

  const toolbar = document.createElement("div");
  toolbar.className = "te-toolbar";
  toolbar.innerHTML = `
    <div class="te-toolbar-summary">
      <span class="te-toolbar-stat">账号数 <strong class="te-account-count">0</strong></span>
      <span class="te-toolbar-stat">总余额 <strong class="te-total-credit">--</strong></span>
    </div>
    <div class="te-toolbar-actions">
      <button class="te-primary te-login-new" type="button">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="10" cy="8" r="4"/>
          <path d="M2 21a8 8 0 0 1 16 0M19 8v6M16 11h6"/>
        </svg>
        <span>登录</span>
      </button>
      <button class="te-secondary te-account-io te-export-accounts" type="button" title="导出账号" aria-label="导出账号">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v12M7 10l5 5 5-5"/>
          <path d="M5 21h14"/>
        </svg>
      </button>
      <button class="te-secondary te-account-io te-import-accounts" type="button" title="导入账号" aria-label="导入账号">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 17V5M7 10l5-5 5 5"/>
          <path d="M5 21h14"/>
        </svg>
      </button>
      <button class="te-secondary te-account-io te-run-checkin" type="button" title="立即签到" aria-label="立即签到">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="16" rx="2"/>
          <path d="M16 3v4M8 3v4M3 11h18"/>
          <path d="m9 16 2 2 4-4"/>
        </svg>
      </button>
      <button class="te-secondary te-account-io te-refresh" type="button" title="刷新" aria-label="刷新">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>
        </svg>
      </button>
    </div>
  `;

  const list = document.createElement("div");
  list.className = "te-list";

  accountPane.append(toolbar, list);

  const aboutPane = document.createElement("div");
  aboutPane.className = "te-pane";
  aboutPane.dataset.pane = "about";
  aboutPane.innerHTML = `
    <div class="te-help">
      <header class="te-help-intro">
        <span class="te-help-kicker">本地账号助手</span>
        <h2>切换账号，不用反复扫码</h2>
        <p>账号信息只保存在这台电脑。需要时切换，平时自动维护，不会把数据上传到别处。</p>
      </header>
      <div class="te-help-steps">
        <article class="te-help-step">
          <span class="te-help-step-num">1</span>
          <div>
            <h3>添加账号</h3>
            <p>点「登录」，推荐选择「无感登录」。在浏览器完成授权后，账号会自动出现在列表里。</p>
          </div>
        </article>
        <article class="te-help-step">
          <span class="te-help-step-num">2</span>
          <div>
            <h3>切换账号</h3>
            <p>点账号卡片右侧的切换按钮。TRAE 会短时间重启，原来的账号会自动备份，失败也会恢复。</p>
          </div>
        </article>
        <article class="te-help-step">
          <span class="te-help-step-num">3</span>
          <div>
            <h3>换电脑</h3>
            <p>用导出、导入迁移账号。导出文件由你设置的密码加密，请把密码单独保存好。</p>
          </div>
        </article>
      </div>
      <div class="te-help-note-wrap">
        <strong>自动维护</strong>
        <p class="te-feature-checkin">每天自动核对签到状态，并在需要时更新账号信息。</p>
        <p>只在登录信息临近到期时才更新，避免频繁操作影响其他设备。</p>
      </div>
      <details class="te-help-details">
        <summary>数据安全</summary>
        <p>导出后的账号是一份搬迁副本，不是共享账号。原设备继续使用或更新登录信息后，另一台设备上的副本可能失效，需要重新登录。</p>
      </details>
      <footer class="te-help-version">TRAE SOLO CN Enhancer v${APP_VERSION}</footer>
    </div>
  `;

  const settingsPane = document.createElement("div");
  settingsPane.className = "te-pane";
  settingsPane.dataset.pane = "settings";
  settingsPane.innerHTML = `
    <div class="te-settings-shell">
      <nav class="te-settings-nav" aria-label="设置分类">
        <button class="te-settings-nav-item active" type="button" data-settings-section="checkin">签到</button>
        <button class="te-settings-nav-item" type="button" data-settings-section="update">更新</button>
        <button class="te-settings-nav-item" type="button" data-settings-section="maintenance">维护</button>
      </nav>
      <div class="te-settings-panels">
        <section class="te-settings-panel active" data-settings-panel="checkin">
          <div class="te-settings-panel-head">
            <div><h2>自动签到</h2><p>只给今天还没签到的账号补领，不会切换当前账号。</p></div>
            <span class="te-badge te-checkin-badge">未读取</span>
          </div>
          <div class="te-section">
            <label class="te-field"><span>自动签到</span><select class="te-select te-checkin-auto"><option value="on">开启</option><option value="off">关闭</option></select></label>
            <label class="te-field"><span>检查间隔</span><select class="te-select te-checkin-interval"></select></label>
            <label class="te-field"><span>页面加载时补签</span><select class="te-select te-checkin-clientload"><option value="on">开启</option><option value="off">关闭</option></select></label>
            <div class="te-status-list te-checkin-status"></div>
            <div class="te-section-actions"><button class="te-primary te-checkin-save" type="button">保存</button></div>
          </div>
        </section>
        <section class="te-settings-panel" data-settings-panel="update">
          <div class="te-settings-panel-head">
            <div><h2>TRAE 更新</h2><p>关闭自动检查可以避免更新打断当前会话，手动更新仍然可用。</p></div>
            <span class="te-badge te-trae-badge">未读取</span>
          </div>
          <div class="te-section">
            <select class="te-select te-trae-mode"><option value="suppress">禁止自动更新（推荐）</option><option value="allow">允许自动更新</option></select>
            <div class="te-status-list te-trae-status"></div>
            <div class="te-section-actions"><button class="te-primary te-trae-save" type="button">保存</button></div>
            <div class="te-restart-banner te-trae-restart"><span>已保存，重启 TRAE 后生效。</span></div>
          </div>
        </section>
        <section class="te-settings-panel" data-settings-panel="maintenance">
          <div class="te-settings-panel-head"><div><h2>后台服务</h2><p>遇到面板没有响应时，可以单独重启助手自己的后台服务。</p></div></div>
          <div class="te-section"><div class="te-section-actions"><button class="te-secondary te-daemon-restart" type="button">重启后台服务</button></div></div>
        </section>
      </div>
    </div>
  `;

  content.append(accountPane, settingsPane, aboutPane);

  const footer = document.createElement("div");
  footer.className = "te-footer";
  footer.innerHTML = '<span class="te-dot"></span><span class="te-status">连接中</span>';

  const toast = document.createElement("div");
  toast.className = "te-toast";

  panel.append(header, tabs, content, footer, toast);

  const oauthMask = document.createElement("div");
  oauthMask.className = "te-modal-mask";
  oauthMask.innerHTML = `
    <div class="te-modal" role="dialog" aria-modal="true" aria-label="登录新账号">
      <div class="te-modal-title te-login-progress-title">登录新账号</div>
      <div class="te-modal-status">正在创建授权会话...</div>
      <div class="te-modal-actions">
        <button class="te-secondary te-oauth-reopen" type="button">重新打开</button>
        <button class="te-primary te-oauth-cancel" type="button">取消</button>
      </div>
    </div>
  `;

  const loginChoiceMask = document.createElement("div");
  loginChoiceMask.className = "te-modal-mask";
  loginChoiceMask.innerHTML = `
    <div class="te-modal" role="dialog" aria-modal="true" aria-label="选择登录方式">
      <div class="te-modal-title">选择登录方式</div>
      <div class="te-login-options" role="radiogroup" aria-label="登录方式">
        <label class="te-login-option selected">
          <input type="radio" name="te-login-way" value="fake_logout" checked>
          <span class="te-login-option-copy">
            <span class="te-login-option-title">假退出</span>
            <span class="te-login-option-desc">安全备份当前账号后重启到登录页，新账号登录后自动加入列表</span>
          </span>
        </label>
        <label class="te-login-option">
          <input type="radio" name="te-login-way" value="seamless">
          <span class="te-login-option-copy">
            <span class="te-login-option-title">无感登录</span>
            <span class="te-login-option-desc">不退出 TRAE，在浏览器完成授权后新账号自动加入列表</span>
          </span>
        </label>
      </div>
      <div class="te-modal-actions">
        <button class="te-secondary te-login-choice-cancel" type="button">取消</button>
        <button class="te-primary te-login-choice-confirm" type="button">确定</button>
      </div>
    </div>
  `;

  const transferMask = document.createElement("div");
  transferMask.className = "te-modal-mask";
  transferMask.innerHTML = `
    <div class="te-modal" role="dialog" aria-modal="true" aria-label="账号导入导出">
      <div class="te-modal-title te-transfer-title"></div>
      <div class="te-transfer-body"></div>
      <div class="te-modal-status te-transfer-status"></div>
      <div class="te-modal-actions">
        <button class="te-secondary te-transfer-cancel" type="button">取消</button>
        <button class="te-primary te-transfer-confirm" type="button">确定</button>
      </div>
    </div>
  `;

  const deleteMask = document.createElement("div");
  deleteMask.className = "te-modal-mask";
  deleteMask.innerHTML = `
    <div class="te-modal" role="dialog" aria-modal="true" aria-label="删除账号备份">
      <div class="te-modal-title">删除账号备份</div>
      <div class="te-modal-status te-delete-status"></div>
      <label class="te-field">
        <span>输入“删除”确认</span>
        <input class="te-delete-confirm" type="text" autocomplete="off" spellcheck="false" placeholder="删除">
      </label>
      <div class="te-modal-actions">
        <button class="te-secondary te-delete-cancel" type="button">取消</button>
        <button class="te-danger te-delete-submit" type="button" disabled>删除</button>
      </div>
    </div>
  `;

  const importFileInput = document.createElement("input");
  importFileInput.type = "file";
  importFileInput.accept = ".json,application/json";
  importFileInput.hidden = true;

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

  root.append(panel, loginChoiceMask, oauthMask, transferMask, deleteMask, importFileInput, fab);
  document.body.appendChild(root);

  let toastTimer = null;
  let refreshGeneration = 0;
  let insightsRefreshGeneration = 0;
  let activeTab = "account";
  let accountCount = 0;
  let oauthSession = null;
  let oauthPollTimer = null;
  let fakeLogoutSession = null;
  let fakeLogoutPollTimer = null;
  let backgroundLoginNoticeShown = false;
  let transferBusy = false;
  let transferSubmit = null;
  let checkinBusy = false;
  // True while the daemon is reconciling check-in state after the panel was
  // opened. Accounts without a confirmed record show "同步中" instead of the
  // misleading "待签到" during that window.
  let syncingCheckin = false;
  // Why the automatic adoption of the signed-in account failed, if it did. Kept
  // here so the empty state can say it instead of looking like "no accounts yet".
  let adoptionError = null;
  let accountsById = new Map();
  let deleteAccountId = null;
  let deleteAccountName = "";

  function loginSessionSeen(sessionId) {
    if (!sessionId) return false;
    try {
      return localStorage.getItem(`trae-enhancer:login:${sessionId}`) === "seen";
    } catch {
      return false;
    }
  }

  function markLoginSessionSeen(sessionId) {
    if (!sessionId) return;
    try {
      localStorage.setItem(`trae-enhancer:login:${sessionId}`, "seen");
    } catch {
      // Local storage is optional; the in-memory guard still prevents repeats.
    }
  }

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

  function formatNumber(value) {
    if (!Number.isFinite(Number(value))) return String(value ?? "--");
    return new Intl.NumberFormat("zh-CN", {
      maximumFractionDigits: 2,
    }).format(Number(value));
  }

  function accountMeta(account) {
    return [
      account.phone || account.maskedPhone,
      account.maskedEmail || account.maskedUserId,
    ].filter(Boolean).join(" · ") || "已保存认证";
  }

  function checkinDateKey() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function accountCheckinView(account) {
    const checkin = account.checkin;
    const checkedToday =
      checkin?.date === checkinDateKey() && checkin.checkedInToday === true;
    if (checkedToday) {
      return {
        label: "已签到",
        state: "checked",
        title: checkin.reward
          ? `今日签到奖励 ${checkin.reward} 积分`
          : checkin.reason === "scheduled"
            ? "今日已自动签到"
            : "今日已签到",
      };
    }
    if (checkin?.error) {
      return {
        label: "失败",
        state: "error",
        title: checkin.error,
      };
    }
    // The daemon reconciles against the server when the panel opens. Until it
    // answers, "待签到" would be a guess: the account may already be checked in
    // and simply have no local record yet, which is the case reported on the
    // intranet machine.
    if (syncingCheckin) {
      return {
        label: "同步中",
        state: "pending",
        title: "正在向服务端核对今日签到状态",
      };
    }
    return {
      label: "待签到",
      state: "pending",
      title: "今日尚未签到",
    };
  }

  const CREDENTIAL_URGENT_MS = 24 * 60 * 60 * 1000;
  const CREDENTIAL_WARN_MS = 7 * 24 * 60 * 60 * 1000;

  function formatExpiry(value) {
    if (!value) return "";
    const date = new Date(value);
    const pad = (part) => String(part).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  function accountCredentialView(account) {
    const keepalive = account.keepalive;
    if (keepalive?.status === "error") {
      return {
        label: "同步失败",
        state: "error",
        title: keepalive.error || "账号同步失败",
      };
    }
    const expiresAt = new Date(keepalive?.accessExpiresAt || NaN).getTime();
    if (!Number.isFinite(expiresAt)) {
      // An unknown expiry is a bare dash, with no promise attached: the sweep that
      // writes this field can be skipped, and opening the panel already fills it
      // from the account's own snapshot.
      return { label: "-", state: "pending", title: "" };
    }
    const stamp = formatExpiry(keepalive.accessExpiresAt);
    const remaining = expiresAt - Date.now();
    // Past and imminent expiry are label-plus-colour only. No tooltip promises a
    // refresh: the sweep that renews this can be skipped, so the promise can be
    // false. This mirrors the reference panel, which never attaches one here.
    if (remaining <= 0) {
      return { label: `已过期 ${stamp}`, state: "error", title: "" };
    }
    if (remaining < CREDENTIAL_URGENT_MS) {
      return { label: `即将过期 ${stamp}`, state: "error", title: "" };
    }
    if (remaining < CREDENTIAL_WARN_MS) {
      return { label: stamp, state: "warning", title: "" };
    }
    return { label: stamp, state: "checked", title: "" };
  }

  function accountCreditView(account) {
    const insights = account.insights;
    if (!insights) {
      return { value: "--", detail: "额度未同步", error: false };
    }
    const plan = insights.plan || insights.planKey || "套餐未知";
    const quota = insights.quota || {};
    let value = "--";
    let detail = "";
    if (quota.model === "credits") {
      value = quota.credits?.unlimited
        ? "不限量"
        : formatNumber(quota.credits?.remaining ?? "--");
    } else if (quota.model === "fast_request") {
      value = quota.fastLimit === -1
        ? "不限量"
        : formatNumber(quota.fastAvailable ?? "--");
      detail = "速通";
    } else if (quota.model === "usd" && quota.basicQuota > 0) {
      value = formatNumber(quota.basicUsage ?? 0);
      detail = `/ ${formatNumber(quota.basicQuota)}`;
    } else if (quota.fastPerMonth !== null && quota.fastPerMonth !== undefined) {
      value = formatNumber(quota.fastPerMonth);
      detail = "次/月";
    }
    return {
      plan,
      value,
      detail: detail || (insights.resetAt ? `重置 ${formatTime(insights.resetAt)}` : "剩余额度"),
      error: !!insights.error,
    };
  }

  function renderAccounts(accounts, currentAccountId, currentAccountState) {
    list.replaceChildren();
    accountsById = new Map(accounts.map((account) => [account.id, account]));
    if (!accounts.length) {
      const empty = document.createElement("div");
      empty.className = "te-empty";
      if (adoptionError) {
        // Two different situations, two different messages. Until now both of them
        // read "暂无账号备份", which is why a failed first run looked like a
        // feature that had not been built.
        empty.textContent = `自动纳管当前账号失败：${adoptionError}`;
        const retry = document.createElement("button");
        retry.className = "te-secondary te-adopt-retry";
        retry.type = "button";
        retry.textContent = "重新尝试";
        retry.addEventListener("click", () => {
          retryAutoBackup(retry).catch(() => {});
        });
        empty.append(retry);
      } else if (currentAccountState === "unknown") {
        empty.textContent = "TRAE 尚未登录";
      } else {
        empty.textContent = "暂无账号备份";
      }
      list.appendChild(empty);
      return;
    }

    const totalCredits = accounts.reduce((sum, account) => {
      const credits = account.insights?.credits;
      return sum + (Number.isFinite(credits?.remaining) && credits.remaining >= 0
        ? credits.remaining
        : 0);
    }, 0);
    toolbar.querySelector(".te-account-count").textContent = String(accounts.length);
    toolbar.querySelector(".te-total-credit").textContent =
      accounts.some((account) => account.insights?.credits) ? formatNumber(totalCredits) : "--";

    for (const account of accounts) {
      const card = document.createElement("article");
      card.className = `te-card${account.id === currentAccountId ? " current" : ""}`;

      const row = document.createElement("div");
      row.className = "te-account-row";

      const main = document.createElement("div");
      main.className = "te-account-main";
      const name = document.createElement("div");
      name.className = "te-name";
      name.textContent = account.displayName || "TRAE account";
      main.appendChild(name);

      const ops = document.createElement("div");
      ops.className = "te-account-ops";

      let action;
      if (account.id === currentAccountId) {
        action = document.createElement("span");
        action.className = "te-current";
        action.textContent = "当前";
        ops.appendChild(action);
      } else {
        action = document.createElement("button");
        action.className = "te-icon-btn te-acc-switch";
        action.type = "button";
        action.title = "切换到此账号";
        action.setAttribute("aria-label", "切换到此账号");
        action.dataset.accountId = account.id;
        action.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 3l4 4-4 4"/>
            <path d="M20 7H8"/>
            <path d="M8 21l-4-4 4-4"/>
            <path d="M4 17h12"/>
          </svg>
        `;
        const remove = document.createElement("button");
        remove.className = "te-icon-btn te-acc-delete";
        remove.type = "button";
        remove.title = "删除本地备份";
        remove.setAttribute("aria-label", `删除 ${account.displayName || "该账号"} 的本地备份`);
        remove.dataset.accountId = account.id;
        remove.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/>
          </svg>
        `;
        ops.append(action, remove);
      }
      row.append(main, ops);

      const creditView = accountCreditView(account);
      const meta = document.createElement("div");
      meta.className = "te-meta-row";
      const phone = document.createElement("span");
      phone.className = "te-meta-item";
      phone.innerHTML = '<span class="te-meta-label">手机</span><span class="te-meta-value"></span>';
      phone.querySelector(".te-meta-value").textContent =
        account.phone || account.maskedPhone || "未获取";
      const plan = document.createElement("span");
      plan.className = "te-meta-item";
      plan.innerHTML = '<span class="te-meta-label">套餐</span><span class="te-meta-value"></span>';
      plan.querySelector(".te-meta-value").textContent = creditView.plan || "未知";
      const checkinView = accountCheckinView(account);
      const checkin = document.createElement("span");
      checkin.className = "te-meta-item";
      checkin.innerHTML = '<span class="te-meta-label">签到</span><span class="te-meta-value te-checkin-state"></span>';
      const checkinValue = checkin.querySelector(".te-checkin-state");
      checkinValue.textContent = checkinView.label;
      checkinValue.classList.add(checkinView.state);
      checkinValue.title = checkinView.title || "";
      const credentialView = accountCredentialView(account);
      const credential = document.createElement("span");
      credential.className = "te-meta-item";
      credential.innerHTML = '<span class="te-meta-label">有效期至</span><span class="te-meta-value te-keepalive-state"></span>';
      const credentialValue = credential.querySelector(".te-keepalive-state");
      credentialValue.textContent = credentialView.label;
      credentialValue.classList.add(credentialView.state);
      credentialValue.title = credentialView.title || "";
      meta.append(phone, plan, checkin, credential);

      const credit = document.createElement("div");
      credit.className = "te-credit-block";
      const creditLabel = document.createElement("span");
      creditLabel.className = "te-credit-label";
      creditLabel.textContent = "剩余";
      const creditValue = document.createElement("strong");
      creditValue.className = "te-credit-value";
      creditValue.textContent = creditView.value;
      const creditDetail = document.createElement("span");
      creditDetail.className = "te-credit-detail";
      creditDetail.textContent = creditView.error ? "额度更新失败" : creditView.detail;
      creditDetail.title = account.insights?.error || creditDetail.textContent;
      credit.append(creditLabel, creditValue, creditDetail);

      card.append(row, meta, credit);
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
      if (
        fakeLogoutSession &&
        !["complete", "error", "cancelled"].includes(fakeLogoutSession.status)
      ) {
        status.textContent =
          fakeLogoutSession.status === "awaiting_login"
            ? "等待新账号登录"
            : fakeLogoutSession.message || "登录处理中";
      } else {
        status.textContent = health.cdpConnected ? "CDP 已连接" : "等待 CDP";
      }
      accountCount = data.accounts.length;
      header.querySelector(".te-subtitle").textContent =
        activeTab === "about" ? `v${APP_VERSION}` : `账号 ${accountCount}`;
      renderAccounts(data.accounts, data.currentAccountId, data.currentAccountState);
      return data;
    } catch (error) {
      if (generation !== refreshGeneration) return;
      const status = footer.querySelector(".te-status");
      footer.querySelector(".te-dot").classList.remove("online");
      status.textContent = "服务不可用";
      showToast(error.message || String(error), true);
      return null;
    } finally {
      refreshButton.disabled = false;
    }
  }

  /**
   * Adopts the account that is signed in right now.
   *
   * The failure is returned instead of swallowed: "nothing to adopt" and
   * "adoption failed" used to produce the same empty list, which made a broken
   * first run indistinguishable from an account that was never added.
   */
  async function autoBackupCurrent() {
    try {
      const result = await api("/api/accounts/backup", { method: "POST", body: "{}" });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  async function retryAutoBackup(button) {
    button.disabled = true;
    button.textContent = "纳管中…";
    const backup = await autoBackupCurrent();
    adoptionError = backup.ok ? null : backup.error;
    await refresh();
    if (backup.ok) await reconcileWithDaemon();
  }

  function switchTab(name) {
    activeTab = name === "about" ? "about" : name === "settings" ? "settings" : "account";
    tabs.querySelectorAll(".te-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === activeTab);
    });
    content.querySelectorAll(".te-pane").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.pane === activeTab);
    });
    header.querySelector(".te-subtitle").textContent =
      activeTab === "about"
        ? `v${APP_VERSION}`
        : activeTab === "settings"
          ? "设置"
          : `账号 ${accountCount}`;
    // Read once, then keep whatever the user has typed: re-reading on every tab
    // switch would silently discard an edit in progress.
    if (activeTab === "settings" && !settingsLoaded) loadSettings().catch(() => {});
  }

  function switchSettingsSection(name) {
    const target = ["checkin", "network", "update", "maintenance"].includes(name)
      ? name
      : "checkin";
    settingsPane.querySelectorAll(".te-settings-nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.settingsSection === target);
    });
    settingsPane.querySelectorAll(".te-settings-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.settingsPanel === target);
    });
  }

  function shouldRefreshInsights(accounts) {
    const now = Date.now();
    return accounts.some((account) => {
      const updatedAt = Date.parse(account.insights?.updatedAt || "");
      return !Number.isFinite(updatedAt) || now - updatedAt > 5 * 60 * 1000;
    });
  }

  async function refreshAccountInsights({ manual = false } = {}) {
    const generation = ++insightsRefreshGeneration;
    const button = toolbar.querySelector(".te-refresh");
    if (manual) button.disabled = true;
    try {
      const result = await api("/api/accounts/insights/refresh", {
        method: "POST",
        body: "{}",
      });
      if (generation !== insightsRefreshGeneration) return;
      await refresh();
      if (manual) {
        const details = failureDetails(result);
        const base = result.failed
          ? `额度已更新，${result.failed} 个账号失败`
          : "账号额度已更新";
        showToast(details ? `${base} — ${details}` : base, result.failed > 0);
      }
    } catch (error) {
      if (manual) showToast(error.message || String(error), true);
    } finally {
      if (manual) button.disabled = false;
    }
  }

  /**
   * Asks the daemon to reconcile today's check-in state and credits, then repaints.
   *
   * Used when the panel opens and right after an import. An imported backup carries
   * only authentication state, so those accounts have no check-in record and no
   * credits until the daemon fills them in.
   *
   * `checkinOneAccount()` is idempotent: an account that is already checked in is
   * recorded as such without claiming a second reward. That is what turns the
   * reported "actually checked in, but the panel says pending" into the correct
   * display without the user pressing anything.
   *
   * Returns the daemon result, or null when the request itself failed.
   */
  async function reconcileWithDaemon() {
    let result = null;
    try {
      result = await api("/api/accounts/panel-open", { method: "POST", body: "{}" });
    } catch {
      result = null;
    } finally {
      syncingCheckin = false;
    }
    try {
      await refresh();
    } catch {
      // A later daemon push repaints the panel.
    }
    return result;
  }

  /* ----------------------------------------------------------------------- *
   * Settings tab
   *
   * The release branch only exposes user-level settings that are local and
   * directly verifiable: check-in schedule and TRAE update behaviour.
   * ----------------------------------------------------------------------- */

  const settingsUi = {
    restartButtons: Array.from(settingsPane.querySelectorAll(".te-daemon-restart")),
    traeMode: settingsPane.querySelector(".te-trae-mode"),
    traeBadge: settingsPane.querySelector(".te-trae-badge"),
    traeStatus: settingsPane.querySelector(".te-trae-status"),
    traeSave: settingsPane.querySelector(".te-trae-save"),
    traeRestartBanner: settingsPane.querySelector(".te-trae-restart"),
    checkinBadge: settingsPane.querySelector(".te-checkin-badge"),
    checkinAuto: settingsPane.querySelector(".te-checkin-auto"),
    checkinInterval: settingsPane.querySelector(".te-checkin-interval"),
    checkinClientLoad: settingsPane.querySelector(".te-checkin-clientload"),
    checkinStatus: settingsPane.querySelector(".te-checkin-status"),
    checkinSave: settingsPane.querySelector(".te-checkin-save"),
  };
  let settingsLoaded = false;
  let traeUpdateNoticeShown = false;

  function appendStatusLine(container, label, value) {
    const line = document.createElement("div");
    line.className = "te-status-line";
    const key = document.createElement("b");
    key.textContent = label;
    const text = document.createElement("span");
    text.textContent = value;
    line.append(key, text);
    container.append(line);
  }

  /**
   * Renders the TRAE auto-update section.
   *
   * The value in the file and the saved preference are reported separately: TRAE
   * reads `update.mode` when it starts, so a freshly written value is not live yet,
   * and a section that only said "已禁止" would be wrong until TRAE restarts.
   */
  function renderTraeUpdate(update) {
    if (!update) return;
    const readable = update.readable !== false;
    const suppressed = Boolean(update.settingsSuppressed);
    settingsUi.traeBadge.className = `te-badge te-trae-badge${readable ? (suppressed ? " ok" : " warn") : " warn"}`;
    settingsUi.traeBadge.textContent = readable ? (suppressed ? "已禁止" : "未禁止") : "读取失败";
    settingsUi.traeMode.value = update.suppress ? "suppress" : "allow";

    settingsUi.traeStatus.textContent = "";
    appendStatusLine(settingsUi.traeStatus, "设置文件", update.path ?? "-");
    appendStatusLine(
      settingsUi.traeStatus,
      "文件中的值",
      readable
        ? update.settingsExists
          ? update.fileMode
            ? `update.mode = ${update.fileMode}`
            : "未写入（TRAE 使用默认值，每 60 分钟检查一次）"
          : "文件不存在"
        : "无法读取",
    );
    if (update.error) appendStatusLine(settingsUi.traeStatus, "错误", update.error);
    if (update.backupPath) {
      appendStatusLine(settingsUi.traeStatus, "改动前备份", update.backupPath);
    }
    if (update.startupNotice && !traeUpdateNoticeShown) {
      traeUpdateNoticeShown = true;
      appendStatusLine(
        settingsUi.traeStatus,
        "本次启动",
        "已自动写入一次（这是默认设置）。不想改动 TRAE 的配置文件，就在下面选择「允许自动更新」并保存。",
      );
      showToast("已自动为 TRAE 关闭自动更新，可在设置里改回");
    }
  }

  async function saveTraeUpdate() {
    const suppress = settingsUi.traeMode.value !== "allow";
    settingsUi.traeSave.disabled = true;
    try {
      const data = await api("/api/settings/trae-update", {
        method: "POST",
        body: JSON.stringify({ suppress }),
      });
      renderTraeUpdate(data.traeUpdate);
      if (data.traeUpdate?.changed === false) {
        settingsUi.traeRestartBanner.classList.remove("show");
        showToast("TRAE 的设置本来就是这个值，没有改动");
      } else {
        settingsUi.traeRestartBanner.classList.add("show");
        showToast(suppress ? "已禁止 TRAE 自动更新，重启 TRAE 后生效" : "已恢复 TRAE 自动更新，重启 TRAE 后生效");
      }
    } catch (error) {
      showToast(error.message || String(error), true);
    } finally {
      settingsUi.traeSave.disabled = false;
    }
  }

  /**
   * Enables or disables the two fields the master switch governs.
   *
   * Disabled rather than hidden, so the values that come back on re-enabling stay
   * visible. It covers the automatic runs only: opening the panel and the
   * 「立即签到」 button are deliberate user actions and stay available either way.
   */
  function applyCheckinVisibility(auto) {
    settingsUi.checkinInterval.disabled = !auto;
    settingsUi.checkinClientLoad.disabled = !auto;
  }

  function renderCheckin(checkin) {
    if (!checkin) return;
    // The allowed intervals come from the daemon, so the panel cannot drift away
    // from the values the daemon will actually accept.
    settingsUi.checkinInterval.textContent = "";
    for (const minutes of checkin.options ?? []) {
      const option = document.createElement("option");
      option.value = String(minutes);
      option.textContent = `每 ${minutes} 分钟`;
      settingsUi.checkinInterval.append(option);
    }
    settingsUi.checkinInterval.value = String(checkin.intervalMinutes);
    settingsUi.checkinAuto.value = checkin.auto ? "on" : "off";
    settingsUi.checkinClientLoad.value = checkin.onClientLoad ? "on" : "off";
    applyCheckinVisibility(checkin.auto);

    settingsUi.checkinBadge.className = `te-badge te-checkin-badge${checkin.auto ? " ok" : ""}`;
    settingsUi.checkinBadge.textContent = checkin.auto ? "已开启" : "已关闭";

    settingsUi.checkinStatus.textContent = "";
    if (checkin.auto) {
      appendStatusLine(settingsUi.checkinStatus, "检查间隔", `每 ${checkin.intervalMinutes} 分钟`);
      appendStatusLine(
        settingsUi.checkinStatus,
        "页面加载",
        checkin.onClientLoad ? "TRAE 重启后立即补签" : "不补签，等下一次检查",
      );
    } else {
      appendStatusLine(
        settingsUi.checkinStatus,
        "说明",
        "已关闭自动签到。打开面板仍会核对今日状态，「立即签到」按钮照常可用。",
      );
    }
  }

  async function saveCheckinConfig() {
    const body = {
      auto: settingsUi.checkinAuto.value === "on",
      intervalMinutes: Number(settingsUi.checkinInterval.value),
      onClientLoad: settingsUi.checkinClientLoad.value === "on",
    };
    settingsUi.checkinSave.disabled = true;
    try {
      const data = await api("/api/settings/checkin", {
        method: "POST",
        body: JSON.stringify(body),
      });
      renderCheckin(data.checkin);
      applyAboutCheckinText(data.checkin);
      // The daemon rebuilds its schedule in place, so "已保存" and "已生效"
      // are the same moment.
      showToast("已保存，立即生效");
    } catch (error) {
      showToast(error.message || String(error), true);
    } finally {
      settingsUi.checkinSave.disabled = false;
    }
  }

  /**
   * Keeps the feature list honest.
   *
   * The entry used to read "每天自动检查", which stops being true the moment the
   * switch is turned off or the interval changes.
   */
  function applyAboutCheckinText(checkin) {
    const target = aboutPane.querySelector(".te-feature-checkin");
    if (!target || !checkin) return;
    if (!checkin.auto) {
      target.textContent =
        "自动领取已关闭。想手动领就点工具栏上的「立即签到」；打开这个面板时也会自动核对一次。";
      return;
    }
    const every = `每 ${checkin.intervalMinutes} 分钟检查一次，当天还没领的账号自动补领`;
    target.textContent = checkin.onClientLoad
      ? `${every}；TRAE 重启后也会立刻补一次。`
      : `${every}。`;
  }

  /**
   * Read once when the panel opens, so the feature list matches the saved settings
   * even when the settings tab was never visited. Not a poll: it runs on open.
   */
  async function refreshAboutCheckinText() {
    try {
      const data = await api("/api/settings");
      applyAboutCheckinText(data.checkin);
    } catch {
      // The generic wording stays; it is not worth an error in the panel footer.
    }
  }

  async function loadSettings({ silent = false } = {}) {
    try {
      const data = await api("/api/settings");
      renderTraeUpdate(data.traeUpdate);
      renderCheckin(data.checkin);
      settingsLoaded = true;
    } catch (error) {
      settingsUi.traeBadge.className = "te-badge te-trae-badge warn";
      settingsUi.traeBadge.textContent = "读取失败";
      settingsUi.traeStatus.textContent = "";
      appendStatusLine(settingsUi.traeStatus, "错误", error.message || String(error));
      if (!silent) showToast(error.message || String(error), true);
    }
  }

  /**
   * Polls health until the daemon answers again. The restart is asynchronous by
   * design: the helper has to outlive the process it replaces.
   */
  async function waitForDaemonReady({ timeoutMs = 60000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    await new Promise((resolve) => setTimeout(resolve, 800));
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
        if (response.ok) return true;
      } catch {
        // Still down; keep waiting.
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return false;
  }

  async function requestDaemonRestart() {
    for (const button of settingsUi.restartButtons) button.disabled = true;
    showToast("正在重启守护进程...");
    try {
      await api("/api/daemon/restart", { method: "POST", body: "{}" });
    } catch (error) {
      for (const button of settingsUi.restartButtons) button.disabled = false;
      showToast(error.message || String(error), true);
      return;
    }
    const ready = await waitForDaemonReady();
    for (const button of settingsUi.restartButtons) button.disabled = false;
    if (!ready) {
      showToast("守护进程没有在预期时间内恢复，请查看日志", true);
      return;
    }
    showToast("守护进程已重启");
    settingsUi.restartBanner.classList.remove("show");
    await loadSettings();
    refresh().catch(() => {});
  }

  /**
   * The daemon pushes this after any account state change. Nothing is requested
   * while the panel is closed, and the handler never asks for a credit refresh:
   * the daemon already pushes after its own refresh, so asking again here would
   * loop. The 150ms debounce collapses a burst of changes into one repaint.
   *
   * The listener is removed by `__traeEnhancerCleanup`, because the daemon
   * re-injects this script every time CDP reconnects.
   */
  let accountsUpdatedPending = false;
  let accountsUpdatedTimer = null;
  function handleAccountsUpdated() {
    if (!panel.classList.contains("open") || accountsUpdatedPending) return;
    accountsUpdatedPending = true;
    accountsUpdatedTimer = setTimeout(() => {
      accountsUpdatedPending = false;
      if (panel.classList.contains("open")) refresh().catch(() => {});
    }, 150);
  }
  window.addEventListener(ACCOUNTS_UPDATED_EVENT, handleAccountsUpdated);

  function failureDetails(result) {
    const failures = Array.isArray(result?.results)
      ? result.results.filter((entry) => entry && entry.ok === false && entry.error)
      : [];
    if (!failures.length) return "";
    const shown = failures.slice(0, 2).map((entry) => String(entry.error));
    const extra = failures.length - shown.length;
    return `${shown.join(" / ")}${extra > 0 ? ` （另有 ${extra} 个）` : ""}`;
  }

  async function runAccountCheckin() {
    if (checkinBusy) return;
    const button = toolbar.querySelector(".te-run-checkin");
    checkinBusy = true;
    button.disabled = true;
    showToast("正在检查全部账号的签到状态...");
    try {
      const result = await api("/api/checkin/run", {
        method: "POST",
        body: "{}",
      });
      await refresh();
      const summary = [
        result.checkedIn ? `新签到 ${result.checkedIn}` : "",
        result.skipped ? `已签到 ${result.skipped}` : "",
        result.failed ? `失败 ${result.failed}` : "",
      ].filter(Boolean).join("，");
      const details = failureDetails(result);
      const base = summary ? `签到完成：${summary}` : "全部账号今日均已签到";
      showToast(details ? `${base} — ${details}` : base, result.failed > 0);
      if (result.checkedIn > 0) {
        refreshAccountInsights().catch(() => {});
      }
    } catch (error) {
      showToast(error.message || String(error), true);
    } finally {
      checkinBusy = false;
      button.disabled = false;
    }
  }

  async function switchAccount(button, accountId) {
    const card = button.closest(".te-card");
    const name = card?.querySelector(".te-name")?.textContent || "目标账号";
    button.disabled = true;
    showToast(`正在切换到「${name}」...`);
    try {
      await api("/api/accounts/switch", {
        method: "POST",
        body: JSON.stringify({ accountId }),
      });
      showToast(`已切换到「${name}」`);
      await refresh();
    } catch (error) {
      showToast(error.message || String(error), true);
      await refresh();
    } finally {
      button.disabled = false;
    }
  }

  function openDeleteDialog(account) {
    deleteAccountId = account.id;
    deleteAccountName = account.displayName || "该账号";
    const status = deleteMask.querySelector(".te-delete-status");
    status.textContent = `将删除「${deleteAccountName}」的本地备份。不会退出 TRAE 当前登录，也不能在助手内撤销。`;
    const input = deleteMask.querySelector(".te-delete-confirm");
    input.value = "";
    deleteMask.querySelector(".te-delete-submit").disabled = true;
    deleteMask.classList.add("open");
    input.focus();
  }

  function closeDeleteDialog() {
    deleteMask.classList.remove("open");
    deleteAccountId = null;
    deleteAccountName = "";
    deleteMask.querySelector(".te-delete-confirm").value = "";
    deleteMask.querySelector(".te-delete-submit").disabled = true;
  }

  async function confirmDeleteAccount() {
    if (!deleteAccountId) return;
    const submit = deleteMask.querySelector(".te-delete-submit");
    const status = deleteMask.querySelector(".te-delete-status");
    submit.disabled = true;
    status.textContent = `正在删除「${deleteAccountName}」的本地备份...`;
    try {
      await api("/api/accounts/delete", {
        method: "POST",
        body: JSON.stringify({ accountId: deleteAccountId }),
      });
      const deletedName = deleteAccountName;
      closeDeleteDialog();
      showToast(`已删除「${deletedName}」的本地备份`);
      await refresh();
    } catch (error) {
      status.textContent = error.message || String(error);
      submit.disabled = false;
    }
  }

  function setLoginStatus(message, error = false) {
    const status = oauthMask.querySelector(".te-modal-status");
    status.textContent = message;
    status.style.color = error ? "#ef4444" : "";
  }

  function showLoginProgress(title, message, { reopen = false } = {}) {
    oauthMask.querySelector(".te-login-progress-title").textContent = title;
    oauthMask.querySelector(".te-oauth-reopen").hidden = !reopen;
    oauthMask.querySelector(".te-oauth-cancel").textContent = "取消";
    setLoginStatus(message);
    oauthMask.classList.add("open");
  }

  function stopOAuthPolling() {
    clearTimeout(oauthPollTimer);
    oauthPollTimer = null;
  }

  function stopFakeLogoutPolling() {
    clearTimeout(fakeLogoutPollTimer);
    fakeLogoutPollTimer = null;
  }

  function closeOAuthDialog({ cancel = false } = {}) {
    stopOAuthPolling();
    if (cancel && oauthSession?.loginId) {
      api("/api/oauth/cancel", {
        method: "POST",
        body: JSON.stringify({ loginId: oauthSession.loginId }),
      }).catch(() => {});
    }
    oauthSession = null;
    oauthMask.classList.remove("open");
  }

  function closeLoginChoice() {
    loginChoiceMask.classList.remove("open");
  }

  function openLoginChoice() {
    if (
      fakeLogoutSession?.sessionId &&
      !isFakeLogoutTerminal(fakeLogoutSession.status)
    ) {
      showLoginProgress("假退出", fakeLogoutMessage(fakeLogoutSession));
      pollFakeLogout({ showProgress: true }).catch(() => {});
      return;
    }
    const options = loginChoiceMask.querySelectorAll(".te-login-option");
    for (const option of options) {
      const input = option.querySelector("input");
      option.classList.toggle("selected", !!input?.checked);
    }
    loginChoiceMask.classList.add("open");
  }

  async function pollOAuthStatus() {
    if (!oauthSession?.loginId) return;
    try {
      const result = await api(
        `/api/oauth/status?loginId=${encodeURIComponent(oauthSession.loginId)}`,
      );
      if (result.status === "pending") {
        setLoginStatus("请在浏览器中完成扫码或账号授权，完成后会自动加入账号列表。");
      } else if (result.status === "exchanging") {
        setLoginStatus("授权已收到，正在保存账号登录信息...");
      } else if (result.status === "syncing") {
        setLoginStatus("账号已保存，正在同步额度和签到...");
      } else if (result.status === "complete") {
        setLoginStatus("账号已加入列表，当前登录账号不会被切换。");
        await refresh();
        setTimeout(() => closeOAuthDialog(), 1200);
        return;
      } else if (result.status === "error") {
        setLoginStatus(result.error || "登录失败", true);
        return;
      } else if (result.status === "cancelled") {
        closeOAuthDialog();
        return;
      }
      oauthPollTimer = setTimeout(pollOAuthStatus, 1000);
    } catch (error) {
      setLoginStatus(error.message || String(error), true);
    }
  }

  async function startOAuth() {
    const button = toolbar.querySelector(".te-login-new");
    button.disabled = true;
    showLoginProgress("无感登录", "正在创建授权会话...", { reopen: true });
    try {
      const result = await api("/api/oauth/start", {
        method: "POST",
        body: "{}",
      });
      oauthSession = result;
      if (result.browserOpened) {
        setLoginStatus("请在浏览器中完成扫码或账号授权，完成后会自动加入账号列表。");
      } else {
        setLoginStatus(result.browserError || "浏览器未能自动打开，请点击“重新打开”。", true);
      }
      oauthPollTimer = setTimeout(pollOAuthStatus, 800);
    } catch (error) {
      setLoginStatus(error.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function fakeLogoutMessage(result) {
    if (result.message) return result.message;
    const messages = {
      preparing: "正在备份当前账号...",
      stopping: "正在安全关闭 TRAE SOLO CN...",
      clearing: "正在切换到登录页...",
      starting: "正在重新打开 TRAE 登录页...",
      awaiting_login: "请在 TRAE 登录页扫码登录新账号，登录后会自动保存。",
      syncing: "新账号已保存，正在同步额度和签到...",
      cancelling: "正在取消并恢复原账号...",
      restoring: "正在恢复原账号并重新打开 TRAE...",
      complete: "新账号已加入列表。",
      cancelled: "已取消，原账号已恢复。",
      error: result.error || "登录流程失败",
    };
    return messages[result.status] || "正在处理登录流程...";
  }

  function isFakeLogoutTerminal(status) {
    return status === "complete" || status === "error" || status === "cancelled";
  }

  async function pollFakeLogout({ showProgress = false } = {}) {
    if (!fakeLogoutSession?.sessionId) return;
    try {
      const result = await api(
        `/api/fake-logout/status?sessionId=${encodeURIComponent(fakeLogoutSession.sessionId)}`,
      );
      fakeLogoutSession = result;
      const message = fakeLogoutMessage(result);
      if (showProgress) setLoginStatus(message, result.status === "error");

      if (result.status === "complete") {
        stopFakeLogoutPolling();
        markLoginSessionSeen(result.sessionId);
        showToast(message);
        await refresh();
        if (showProgress) setTimeout(() => closeOAuthDialog(), 1200);
        setTimeout(() => {
          fakeLogoutSession = null;
          refresh().catch(() => {});
        }, 1400);
        return;
      }
      if (isFakeLogoutTerminal(result.status)) {
        stopFakeLogoutPolling();
        markLoginSessionSeen(result.sessionId);
        showToast(message, result.status === "error");
        await refresh();
        if (showProgress) {
          setLoginStatus(message, result.status === "error");
        }
        return;
      }
      fakeLogoutPollTimer = setTimeout(
        () => pollFakeLogout({ showProgress }),
        1000,
      );
    } catch (error) {
      if (showProgress) setLoginStatus(error.message || String(error), true);
      fakeLogoutPollTimer = setTimeout(
        () => pollFakeLogout({ showProgress }),
        2000,
      );
    }
  }

  async function startFakeLogout() {
    const button = toolbar.querySelector(".te-login-new");
    button.disabled = true;
    showLoginProgress("假退出", "正在备份当前账号并准备重启 TRAE...");
    try {
      const result = await api("/api/fake-logout/start", {
        method: "POST",
        body: "{}",
      });
      fakeLogoutSession = result;
      setLoginStatus(fakeLogoutMessage(result));
      stopFakeLogoutPolling();
      fakeLogoutPollTimer = setTimeout(
        () => pollFakeLogout({ showProgress: true }),
        800,
      );
    } catch (error) {
      setLoginStatus(error.message || String(error), true);
    } finally {
      button.disabled = false;
    }
  }

  async function cancelFakeLogout() {
    if (!fakeLogoutSession?.sessionId) return;
    setLoginStatus("正在取消并恢复原账号...");
    try {
      await api("/api/fake-logout/cancel", {
        method: "POST",
        body: JSON.stringify({ sessionId: fakeLogoutSession.sessionId }),
      });
      fakeLogoutSession.status = "cancelling";
      fakeLogoutSession.message = "正在取消并恢复原账号...";
      stopFakeLogoutPolling();
      fakeLogoutPollTimer = setTimeout(
        () => pollFakeLogout({ showProgress: true }),
        500,
      );
    } catch (error) {
      setLoginStatus(error.message || String(error), true);
    }
  }

  async function resumeFakeLogout() {
    try {
      const result = await api("/api/fake-logout/active");
      if (result.status === "missing") return;
      if (isFakeLogoutTerminal(result.status) && loginSessionSeen(result.sessionId)) {
        return;
      }
      fakeLogoutSession = result;
      if (
        !backgroundLoginNoticeShown &&
        !["complete", "error", "cancelled"].includes(result.status)
      ) {
        backgroundLoginNoticeShown = true;
        showToast("假退出登录进行中：请在 TRAE 登录页扫码");
      }
      stopFakeLogoutPolling();
      fakeLogoutPollTimer = setTimeout(
        () => pollFakeLogout({ showProgress: false }),
        600,
      );
    } catch {
      // The daemon may still be starting after TRAE restarts.
    }
  }

  function setTransferStatus(message, error = false) {
    const status = transferMask.querySelector(".te-transfer-status");
    status.textContent = message;
    status.style.color = error ? "#ef4444" : "";
  }

  function closeTransferDialog() {
    transferMask.classList.remove("open");
    transferMask.querySelector(".te-transfer-body").replaceChildren();
    setTransferStatus("");
    transferSubmit = null;
    transferBusy = false;
  }

  function openTransferDialog({ title, confirmText }) {
    transferMask.querySelector(".te-transfer-title").textContent = title;
    transferMask.querySelector(".te-transfer-confirm").textContent = confirmText;
    transferMask.querySelector(".te-transfer-confirm").disabled = false;
    transferMask.querySelector(".te-transfer-cancel").disabled = false;
    const body = transferMask.querySelector(".te-transfer-body");
    body.replaceChildren();
    setTransferStatus("");
    transferMask.classList.add("open");
    return body;
  }

  function createTransferNote(text) {
    const note = document.createElement("div");
    note.className = "te-transfer-note";
    note.textContent = text;
    return note;
  }

  function createField(labelText, { type = "password", autocomplete = "new-password" } = {}) {
    const label = document.createElement("label");
    label.className = "te-field";
    const caption = document.createElement("span");
    caption.textContent = labelText;
    const input = document.createElement("input");
    input.type = type;
    input.autocomplete = autocomplete;
    label.append(caption, input);
    return { label, input };
  }

  function downloadTransfer(result, fallbackName) {
    const blob = new Blob([result.content], {
      type: result.mimeType || "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename || fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 300);
  }

  async function openExportDialog() {
    try {
      const data = await api("/api/accounts");
      if (!data.accounts.length) {
        showToast("没有可导出的账号备份", true);
        return;
      }
      const body = openTransferDialog({
        title: "导出账号",
        confirmText: "导出",
      });
      body.append(
        createTransferNote(
          "导出的是此刻的登录信息，不是可以两台设备共用的副本。导入到其他设备后，本机上的这些账号会被顶下线，需要重新登录才能恢复 —— 请当作搬迁，不要在两台设备上同时管理同一个账号。",
        ),
      );
      const selected = new Set(data.accounts.map((account) => account.id));
      const heading = document.createElement("div");
      heading.className = "te-transfer-select-head";
      const headingLabel = document.createElement("span");
      headingLabel.textContent = "选择账号";
      const toggle = document.createElement("button");
      toggle.className = "te-transfer-toggle";
      toggle.type = "button";
      toggle.textContent = "取消全选";
      heading.append(headingLabel, toggle);

      const options = document.createElement("div");
      options.className = "te-transfer-options";
      for (const account of data.accounts) {
        const label = document.createElement("label");
        label.className = "te-transfer-option selected";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = true;
        input.dataset.accountId = account.id;
        const copy = document.createElement("span");
        copy.className = "te-transfer-option-copy";
        const name = document.createElement("span");
        name.className = "te-transfer-option-name";
        name.textContent = account.displayName || "TRAE account";
        const meta = document.createElement("span");
        meta.className = "te-transfer-option-meta";
        meta.textContent = accountMeta(account);
        copy.append(name, meta);
        label.append(input, copy);
        input.addEventListener("change", () => {
          if (input.checked) selected.add(account.id);
          else selected.delete(account.id);
          label.classList.toggle("selected", input.checked);
          toggle.textContent = selected.size === data.accounts.length ? "取消全选" : "全选";
        });
        options.appendChild(label);
      }
      toggle.addEventListener("click", () => {
        const selectAll = selected.size !== data.accounts.length;
        selected.clear();
        if (selectAll) {
          data.accounts.forEach((account) => selected.add(account.id));
        }
        options.querySelectorAll("input[data-account-id]").forEach((input) => {
          input.checked = selectAll;
          input.closest(".te-transfer-option")?.classList.toggle("selected", selectAll);
        });
        toggle.textContent = selectAll ? "取消全选" : "全选";
      });

      const password = createField("密码");
      const confirmation = createField("确认密码");
      body.append(heading, options, password.label, confirmation.label);
      password.input.focus();

      transferSubmit = async () => {
        if (!selected.size) throw new Error("请至少选择一个账号");
        if (password.input.value.trim().length < 8) {
          throw new Error("密码至少需要 8 个字符");
        }
        if (password.input.value !== confirmation.input.value) {
          throw new Error("两次输入的密码不一致");
        }
        setTransferStatus("正在加密账号备份...");
        const result = await api("/api/accounts/export", {
          method: "POST",
          body: JSON.stringify({
            accountIds: [...selected],
            password: password.input.value,
          }),
        });
        downloadTransfer(result, "TRAE-SOLO-CN-accounts.json");
        showToast(`已导出 ${result.count} 个账号（已加密）`);
        closeTransferDialog();
      };
    } catch (error) {
      showToast(error.message || String(error), true);
      closeTransferDialog();
    }
  }

  async function openImportDialog(file) {
    try {
      if (file.size > 32 * 1024 * 1024) {
        throw new Error("导入文件过大");
      }
      const content = await file.text();
      const body = openTransferDialog({
        title: "导入账号",
        confirmText: "导入",
      });
      const fileName = document.createElement("div");
      fileName.className = "te-transfer-file";
      fileName.textContent = file.name;
      const password = createField("密码", { autocomplete: "current-password" });
      body.append(
        createTransferNote(
          "这是某台设备导出的登录信息。如果原设备仍在运行并自动续期，这里导入的登录会失效（401），需要重新登录 —— 搬迁完成后，请在原设备上停用这些账号。",
        ),
        fileName,
        password.label,
      );
      password.input.focus();

      transferSubmit = async () => {
        if (!password.input.value.trim()) throw new Error("密码不能为空");
        setTransferStatus("正在解密并校验账号备份...");
        const result = await api("/api/accounts/import", {
          method: "POST",
          body: JSON.stringify({
            content,
            password: password.input.value,
          }),
        });
        const detail = result.updated
          ? `，新增 ${result.imported}，更新 ${result.updated}`
          : "";
        showToast(`已导入 ${result.count} 个账号${detail}`);
        closeTransferDialog();
        // An imported backup carries only authentication state, so these accounts
        // have no check-in record and no credits. Ask the daemon to reconcile them
        // right away instead of leaving them pending until the panel is reopened.
        syncingCheckin = true;
        await refresh();
        await reconcileWithDaemon();
      };
    } catch (error) {
      showToast(error.message || String(error), true);
      closeTransferDialog();
    }
  }

  function openPanel() {
    panel.classList.add("open");
    adoptionError = null;
    // The daemon adopts the signed-in account on its own now, so this is only a
    // fallback for the moment the panel is opened. Kept because it is the one path
    // that works when the daemon has been running since before TRAE was signed in.
    void refreshAboutCheckinText();
    // Paint "同步中" first: until the daemon answers, an account with no local
    // check-in record may well already be checked in on the server.
    syncingCheckin = true;
    refresh()
      .then(async (data) => {
        if (
          data?.accounts?.length === 0 &&
          data.currentAccountState === "not-managed"
        ) {
          const backup = await autoBackupCurrent();
          if (backup.ok) {
            adoptionError = null;
            data = await refresh();
          } else {
            adoptionError = backup.error;
            // Repaint so the reason replaces the bare empty state right away.
            renderAccounts(
              data.accounts,
              data.currentAccountId,
              data.currentAccountState,
            );
          }
        }
        const result = await reconcileWithDaemon();
        // The daemon orchestrates check-in and credits whenever it is free. When it
        // is busy or blocked by Cockpit Tools, fall back to v1.0.0's own credit
        // refresh so opening the panel never regresses.
        if (!result || result.busy || result.skipped) {
          if (data?.accounts && shouldRefreshInsights(data.accounts)) {
            refreshAccountInsights().catch(() => {});
          }
        }
      })
      .catch(() => {
        syncingCheckin = false;
      });
  }

  function closePanel() {
    panel.classList.remove("open");
  }

  fab.addEventListener("click", () => {
    if (panel.classList.contains("open")) closePanel();
    else openPanel();
  });
  header.querySelector(".te-close").addEventListener("click", closePanel);
  toolbar.querySelector(".te-refresh").addEventListener("click", () => {
    refreshAccountInsights({ manual: true }).catch(() => {});
  });
  toolbar.querySelector(".te-run-checkin").addEventListener("click", () => {
    runAccountCheckin().catch(() => {});
  });
  toolbar.querySelector(".te-login-new").addEventListener("click", openLoginChoice);
  toolbar.querySelector(".te-export-accounts").addEventListener("click", () => {
    openExportDialog().catch(() => {});
  });
  toolbar.querySelector(".te-import-accounts").addEventListener("click", () => {
    importFileInput.click();
  });
  importFileInput.addEventListener("change", () => {
    const file = importFileInput.files?.[0];
    importFileInput.value = "";
    if (file) openImportDialog(file).catch(() => {});
  });
  tabs.querySelectorAll(".te-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });
  settingsPane.querySelectorAll(".te-settings-nav-item").forEach((item) => {
    item.addEventListener("click", () => switchSettingsSection(item.dataset.settingsSection));
  });
  settingsUi.traeSave.addEventListener("click", () => {
    saveTraeUpdate().catch(() => {});
  });
  settingsUi.checkinSave.addEventListener("click", () => {
    saveCheckinConfig().catch(() => {});
  });
  // The master switch takes effect on the form immediately, so the two governed
  // fields never look editable while they are ignored.
  settingsUi.checkinAuto.addEventListener("change", () => {
    applyCheckinVisibility(settingsUi.checkinAuto.value === "on");
  });
  for (const button of settingsUi.restartButtons) {
    button.addEventListener("click", () => {
      requestDaemonRestart().catch(() => {});
    });
  }
  list.addEventListener("click", (event) => {
    const deleteButton = event.target.closest(".te-acc-delete");
    if (deleteButton?.dataset.accountId) {
      const account = accountsById.get(deleteButton.dataset.accountId);
      if (account) openDeleteDialog(account);
      return;
    }
    const button = event.target.closest(".te-acc-switch");
    if (!button?.dataset.accountId) return;
    switchAccount(button, button.dataset.accountId).catch(() => {});
  });
  deleteMask.querySelector(".te-delete-confirm").addEventListener("input", (event) => {
    deleteMask.querySelector(".te-delete-submit").disabled = event.target.value.trim() !== "删除";
  });
  deleteMask.querySelector(".te-delete-cancel").addEventListener("click", closeDeleteDialog);
  deleteMask.querySelector(".te-delete-submit").addEventListener("click", () => {
    confirmDeleteAccount().catch(() => {});
  });
  deleteMask.addEventListener("click", (event) => {
    if (event.target === deleteMask) closeDeleteDialog();
  });
  deleteMask.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDeleteDialog();
  });
  loginChoiceMask.querySelectorAll(".te-login-option").forEach((option) => {
    option.querySelector("input")?.addEventListener("change", () => {
      loginChoiceMask.querySelectorAll(".te-login-option").forEach((candidate) => {
        candidate.classList.toggle(
          "selected",
          !!candidate.querySelector("input")?.checked,
        );
      });
    });
  });
  loginChoiceMask.querySelector(".te-login-choice-cancel").addEventListener("click", closeLoginChoice);
  loginChoiceMask.querySelector(".te-login-choice-confirm").addEventListener("click", () => {
    const selected = loginChoiceMask.querySelector('input[name="te-login-way"]:checked');
    if (!selected) return;
    closeLoginChoice();
    if (selected.value === "seamless") {
      startOAuth().catch(() => {});
    } else {
      startFakeLogout().catch(() => {});
    }
  });
  oauthMask.querySelector(".te-oauth-reopen").addEventListener("click", () => {
    if (!oauthSession?.loginId) return;
    api("/api/oauth/open", {
      method: "POST",
      body: JSON.stringify({ loginId: oauthSession.loginId }),
    })
      .then((result) => {
        if (!result.opened) setLoginStatus("浏览器未能打开，请稍后重试。", true);
      })
      .catch((error) => setLoginStatus(error.message || String(error), true));
  });
  oauthMask.querySelector(".te-oauth-cancel").addEventListener("click", () => {
    if (
      fakeLogoutSession?.sessionId &&
      !isFakeLogoutTerminal(fakeLogoutSession.status)
    ) {
      cancelFakeLogout().catch(() => {});
    } else {
      closeOAuthDialog({ cancel: true });
    }
  });
  transferMask.querySelector(".te-transfer-cancel").addEventListener("click", () => {
    if (!transferBusy) closeTransferDialog();
  });
  transferMask.querySelector(".te-transfer-confirm").addEventListener("click", async () => {
    if (!transferSubmit || transferBusy) return;
    transferBusy = true;
    const confirm = transferMask.querySelector(".te-transfer-confirm");
    const cancel = transferMask.querySelector(".te-transfer-cancel");
    confirm.disabled = true;
    cancel.disabled = true;
    try {
      await transferSubmit();
    } catch (error) {
      setTransferStatus(error.message || String(error), true);
    } finally {
      transferBusy = false;
      confirm.disabled = false;
      cancel.disabled = false;
    }
  });
  transferMask.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !transferBusy) {
      closeTransferDialog();
      return;
    }
    if (event.key === "Enter" && event.target?.tagName === "INPUT") {
      event.preventDefault();
      transferMask.querySelector(".te-transfer-confirm").click();
    }
  });

  window.__traeEnhancerCleanup = () => {
    clearTimeout(toastTimer);
    clearTimeout(accountsUpdatedTimer);
    window.removeEventListener(ACCOUNTS_UPDATED_EVENT, handleAccountsUpdated);
    stopOAuthPolling();
    stopFakeLogoutPolling();
    root.remove();
    style.remove();
    delete window.__traeEnhancerCleanup;
  };

  resumeFakeLogout().catch(() => {});
})();

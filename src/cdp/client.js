import { setTimeout as delay } from "node:timers/promises";

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchJson(url, { timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isInjectableTarget(target) {
  if (!target || target.type !== "page" || !target.webSocketDebuggerUrl) return false;
  const url = String(target.url || "").toLowerCase();
  const title = String(target.title || "").toLowerCase();
  if (url.startsWith("devtools://")) return false;
  return (
    url.includes("workbench") ||
    url.includes("vscode-file") ||
    title.includes("trae") ||
    title.includes("solo")
  );
}

export class CdpClient {
  constructor({ port, getInjectScript, onStateChange = () => {} }) {
    this.port = port;
    this.getInjectScript = getInjectScript;
    this.onStateChange = onStateChange;
    this.socket = null;
    this.connected = false;
    this.stopped = true;
    this.nextId = 1;
    this.pending = new Map();
    this.loopPromise = null;
    this.target = null;
  }

  get isConnected() {
    return this.connected;
  }

  start() {
    if (this.loopPromise) return;
    this.stopped = false;
    this.loopPromise = this.runLoop().finally(() => {
      this.loopPromise = null;
      this.connected = false;
      this.onStateChange(false);
    });
  }

  async stop() {
    this.stopped = true;
    await this.closeSocket();
    await this.loopPromise?.catch(() => {});
  }

  async listTargets() {
    return await fetchJson(`http://127.0.0.1:${this.port}/json/list`);
  }

  async findTarget() {
    const targets = await this.listTargets();
    return targets.find(isInjectableTarget) || null;
  }

  async runLoop() {
    while (!this.stopped) {
      try {
        const target = await this.findTarget();
        if (!target) {
          await delay(1000);
          continue;
        }
        this.target = target;
        await this.connect(target.webSocketDebuggerUrl);
        await this.inject();
        while (!this.stopped && this.connected) {
          await delay(500);
        }
      } catch {
        // Reconnect quietly. The launcher exposes the actionable error state.
      }
      await this.closeSocket();
      if (!this.stopped) await delay(1200);
    }
  }

  async connect(webSocketDebuggerUrl) {
    await this.closeSocket();
    const socket = new WebSocket(webSocketDebuggerUrl);
    this.socket = socket;

    await withTimeout(
      new Promise((resolve, reject) => {
        const handleOpen = () => {
          socket.removeEventListener("error", handleError);
          resolve();
        };
        const handleError = () => {
          socket.removeEventListener("open", handleOpen);
          reject(new Error("Failed to connect to the TRAE CDP socket"));
        };
        socket.addEventListener("open", handleOpen, { once: true });
        socket.addEventListener("error", handleError, { once: true });
      }),
      5000,
      "Timed out while connecting to the TRAE CDP socket",
    );

    socket.addEventListener("message", (event) => this.handleMessage(event));
    socket.addEventListener("close", () => {
      this.connected = false;
      this.onStateChange(false);
      this.rejectPending(new Error("TRAE CDP connection closed"));
    });
    socket.addEventListener("error", () => {
      this.connected = false;
      this.onStateChange(false);
    });

    this.connected = true;
    this.onStateChange(true);
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  async closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    this.rejectPending(new Error("TRAE CDP connection reset"));
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // Node may already have closed the socket.
    }
  }

  rejectPending(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "CDP command failed"));
      else pending.resolve(message.result);
      return;
    }

    if (message.method === "Page.loadEventFired") {
      this.inject().catch(() => {});
    }
  }

  send(method, params = {}, timeoutMs = 5000) {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error("TRAE CDP is not connected"));
    }
    const id = this.nextId++;
    const command = JSON.stringify({ id, method, params });
    return withTimeout(
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try {
          this.socket.send(command);
        } catch (error) {
          this.pending.delete(id);
          reject(error);
        }
      }),
      timeoutMs,
      `CDP command timed out: ${method}`,
    ).finally(() => this.pending.delete(id));
  }

  async evaluate(expression, { awaitPromise = true, timeoutMs = 5000 } = {}) {
    const result = await this.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture: false,
      },
      timeoutMs,
    );
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "Renderer evaluation failed",
      );
    }
    return result.result?.value;
  }

  async inject() {
    if (!this.connected) return false;
    const script = await this.getInjectScript();
    await this.evaluate(script, { awaitPromise: false, timeoutMs: 10000 });
    return true;
  }

  async getLiveIdentity() {
    if (!this.connected) return null;
    const expression = `
      (async function () {
        try {
          var bridge = globalThis.vscode && globalThis.vscode.ipcRenderer;
          if (!bridge || typeof bridge.invoke !== "function") return null;
          var raw = await bridge.invoke("vscode:sandbox::main-invoke-getUserInfo");
          var info = raw && raw.result ? raw.result : (raw && raw.data ? raw.data : raw);
          if (!info || typeof info !== "object") return null;
          var account = info.account && typeof info.account === "object" ? info.account : {};
          function pick() {
            for (var i = 0; i < arguments.length; i++) {
              var value = arguments[i];
              if (value !== undefined && value !== null && String(value).trim()) {
                return String(value).trim();
              }
            }
            return null;
          }
          return {
            userId: pick(info.userId, info.user_id, info.uid, account.userId, account.user_id, account.id),
            email: pick(info.email, account.email, account.nonPlainTextEmail),
            phone: pick(info.phone, info.mobile, info.phoneNumber, account.phone, account.mobile, account.nonPlainTextMobile),
            nickname: pick(info.nickname, info.name, info.displayName, account.nickname, account.username, account.name, account.ScreenName)
          };
        } catch (_) {
          return null;
        }
      })()
    `;
    try {
      const identity = await this.evaluate(expression, { awaitPromise: true, timeoutMs: 4000 });
      return identity && typeof identity === "object" ? identity : null;
    } catch {
      return null;
    }
  }
}

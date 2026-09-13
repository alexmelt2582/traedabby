import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { readJsonFile } from "./json-file.js";
import { applyAuthClear, applyAuthSnapshot } from "./storage-transaction.js";
import {
  extractAuthSnapshot,
  extractIdentityFromSnapshot,
} from "./trae-storage.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_SETTLE_MS = 800;
const COMPLETED_RETENTION_MS = 10 * 60 * 1000;

function publicSession(session) {
  if (!session) return { status: "missing" };
  return {
    sessionId: session.sessionId,
    status: session.status,
    message: session.message,
    error: session.error,
    account: session.account,
    originalAccount: session.originalAccount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

function setSessionState(session, status, message = "") {
  session.status = status;
  session.message = message;
  session.updatedAt = Date.now();
}

export class TraeFakeLogoutManager {
  constructor({
    accountStore,
    storagePath,
    transactionDir,
    stopTrae,
    startTrae,
    getLiveIdentity = async () => null,
    logger = console,
    sessionTimeoutMs = DEFAULT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    settleMs = DEFAULT_SETTLE_MS,
    now = () => Date.now(),
    sleep = delay,
  }) {
    this.accountStore = accountStore;
    this.storagePath = storagePath;
    this.transactionDir = transactionDir;
    this.stopTrae = stopTrae;
    this.startTrae = startTrae;
    this.getLiveIdentity = getLiveIdentity;
    this.logger = logger;
    this.sessionTimeoutMs = sessionTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.settleMs = settleMs;
    this.now = now;
    this.sleep = sleep;
    this.activeSession = null;
    this.latestSession = null;
  }

  async start() {
    this.pruneRetainedSession();
    const active = this.getActiveSession();
    if (active) {
      throw new Error("A fake logout login flow is already running");
    }

    const storageRoot = await readJsonFile(this.storagePath);
    const originalSnapshot = extractAuthSnapshot(storageRoot);
    const identity = extractIdentityFromSnapshot(originalSnapshot);
    if (!identity.userId) {
      throw new Error("Unable to identify the current TRAE account before fake logout");
    }
    const currentLiveIdentity = await this.getLiveIdentity().catch(() => null);
    const liveIdentity =
      currentLiveIdentity?.userId === identity.userId ? currentLiveIdentity : null;
    const backup = await this.accountStore.backupCurrent(storageRoot, {
      liveIdentity,
    });

    const timestamp = this.now();
    const session = {
      sessionId: crypto.randomUUID(),
      status: "preparing",
      message: "正在准备安全登录流程...",
      error: null,
      account: null,
      originalAccount: backup.account,
      originalSnapshot,
      originalUserId: identity.userId,
      cancelRequested: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + this.sessionTimeoutMs,
    };
    this.activeSession = session;
    this.latestSession = session;

    this.run(session).catch((error) => {
      this.logger.error(
        `[fake-logout] unexpected failure sessionId=${session.sessionId}: ${error.message || error}`,
      );
    });
    return publicSession(session);
  }

  status(sessionId) {
    this.pruneRetainedSession();
    const session =
      (sessionId && this.activeSession?.sessionId === sessionId
        ? this.activeSession
        : sessionId && this.latestSession?.sessionId === sessionId
          ? this.latestSession
          : null) || (!sessionId ? this.activeSession || this.latestSession : null);
    return publicSession(session);
  }

  active() {
    this.pruneRetainedSession();
    return publicSession(this.activeSession);
  }

  isActive() {
    return !!this.getActiveSession();
  }

  cancel(sessionId = "") {
    const session = this.getActiveSession();
    if (!session || (sessionId && session.sessionId !== sessionId)) return false;
    session.cancelRequested = true;
    if (
      session.status === "preparing" ||
      session.status === "stopping" ||
      session.status === "clearing" ||
      session.status === "starting" ||
      session.status === "awaiting_login"
    ) {
      setSessionState(session, "cancelling", "正在取消并恢复原账号...");
    }
    return true;
  }

  getActiveSession() {
    if (!this.activeSession) return null;
    if (
      this.activeSession.status === "complete" ||
      this.activeSession.status === "error" ||
      this.activeSession.status === "cancelled"
    ) {
      return null;
    }
    return this.activeSession;
  }

  pruneRetainedSession() {
    if (!this.activeSession) return;
    const terminal = ["complete", "error", "cancelled"].includes(this.activeSession.status);
    if (!terminal) return;
    if (this.now() - this.activeSession.updatedAt < COMPLETED_RETENTION_MS) return;
    this.activeSession = null;
  }

  async run(session) {
    let cleared = false;
    let traeStopped = false;

    try {
      if (session.cancelRequested) throw new Error("登录流程已取消");

      setSessionState(session, "stopping", "正在安全关闭 TRAE SOLO CN...");
      await this.stopTrae();
      traeStopped = true;
      if (session.cancelRequested) throw new Error("登录流程已取消");

      setSessionState(session, "clearing", "正在切换到登录页...");
      await applyAuthClear({
        storagePath: this.storagePath,
        transactionDir: this.transactionDir,
        now: this.now(),
      });
      cleared = true;

      setSessionState(session, "starting", "正在重新打开 TRAE 登录页...");
      const started = await this.startTrae();
      if (!started) throw new Error("TRAE did not expose the debugging port after restart");
      traeStopped = false;
      if (session.cancelRequested) throw new Error("登录流程已取消");

      setSessionState(session, "awaiting_login", "请在 TRAE 登录页扫码登录新账号。");
      while (this.now() < session.expiresAt) {
        if (session.cancelRequested) throw new Error("登录流程已取消");
        const candidate = await this.detectNewAccount(session.originalUserId);
        if (candidate) {
          if (session.cancelRequested) throw new Error("登录流程已取消");
          const liveIdentity = await this.getLiveIdentity().catch(() => null);
          const matchingLiveIdentity =
            liveIdentity?.userId === candidate.identity.userId ? liveIdentity : null;
          const saved = await this.accountStore.backupCurrent(candidate.storageRoot, {
            liveIdentity: matchingLiveIdentity,
            now: this.now(),
          });
          session.account = saved.account;
          setSessionState(
            session,
            "complete",
            `新账号「${saved.account.displayName}」已加入列表。`,
          );
          this.logger.log(`[fake-logout] completed sessionId=${session.sessionId}`);
          return;
        }
        await this.sleep(this.pollIntervalMs);
      }
      throw new Error("等待新账号登录超时");
    } catch (error) {
      const message = error.message || String(error);
      const cancelled = session.cancelRequested || message === "登录流程已取消";
      if (cleared) {
        setSessionState(session, "restoring", "登录未完成，正在恢复原账号...");
        try {
          if (!traeStopped) await this.stopTrae();
          await applyAuthSnapshot({
            storagePath: this.storagePath,
            snapshot: session.originalSnapshot,
            transactionDir: this.transactionDir,
            now: this.now(),
          });
          const restarted = await this.startTrae();
          if (!restarted) {
            throw new Error("TRAE did not expose the debugging port after restoring the account");
          }
          setSessionState(
            session,
            "cancelled",
            cancelled
              ? "已取消，原账号已恢复。"
              : `登录失败（${message}），原账号已恢复。`,
          );
        } catch (restoreError) {
          setSessionState(
            session,
            "error",
            `恢复原账号失败：${restoreError.message || restoreError}`,
          );
          session.error = restoreError.message || String(restoreError);
          this.logger.error(
            `[fake-logout] restore failed sessionId=${session.sessionId}: ${session.error}`,
          );
          return;
        }
      } else {
        if (traeStopped) {
          await this.startTrae().catch(() => false);
        }
        setSessionState(session, "cancelled", "已取消，当前账号未改变。");
      }
      session.error = cancelled ? null : message;
      this.logger.log(
        `[fake-logout] ${cancelled ? "cancelled" : "failed"} sessionId=${session.sessionId}`,
      );
    }
  }

  async detectNewAccount(originalUserId) {
    let first;
    try {
      first = await this.readCandidateIdentity();
    } catch {
      return null;
    }
    if (!first?.userId || String(first.userId) === String(originalUserId)) return null;

    await this.sleep(this.settleMs);
    let second;
    try {
      second = await this.readCandidateIdentity();
    } catch {
      return null;
    }
    if (!second?.userId || String(second.userId) !== String(first.userId)) return null;

    const storageRoot = await readJsonFile(this.storagePath);
    const snapshot = extractAuthSnapshot(storageRoot);
    const identity = extractIdentityFromSnapshot(snapshot);
    if (!identity.userId || String(identity.userId) !== String(first.userId)) return null;
    return { storageRoot, snapshot, identity };
  }

  async readCandidateIdentity() {
    const root = await readJsonFile(this.storagePath);
    const snapshot = extractAuthSnapshot(root);
    return extractIdentityFromSnapshot(snapshot);
  }
}

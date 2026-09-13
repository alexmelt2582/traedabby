import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runPowerShell(script, { timeout = 15000 } = {}) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      timeout,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout.trim();
}

export async function traeExecutableExists(exePath) {
  try {
    const stat = await fs.stat(exePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function isCdpAvailable(port, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function isTraeCdpAvailable(port, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const targets = await response.json();
    return targets.some((target) => {
      if (target.type !== "page") return false;
      const url = String(target.url || "").toLowerCase();
      const title = String(target.title || "").toLowerCase();
      return (
        url.includes("workbench") ||
        url.includes("vscode-file") ||
        title.includes("trae") ||
        title.includes("solo")
      );
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function findTraeWindowProcessIds(exePath) {
  const script = `
    $target = ${psQuote(exePath)}
    $items = @(Get-Process -Name 'TRAE SOLO CN' -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and $_.Path.Equals($target, [System.StringComparison]::OrdinalIgnoreCase) -and $_.MainWindowHandle -ne 0
    } | Select-Object -ExpandProperty Id)
    $items | ConvertTo-Json -Compress
  `;
  const output = await runPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
}

export async function findTraeProcessIds(exePath) {
  const script = `
    $target = ${psQuote(exePath)}
    @(Get-Process -Name 'TRAE SOLO CN' -ErrorAction SilentlyContinue | Where-Object {
      $_.Path -and $_.Path.Equals($target, [System.StringComparison]::OrdinalIgnoreCase)
    } | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress
  `;
  const output = await runPowerShell(script);
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(Number).filter(Number.isInteger);
}

async function waitForExit(processIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const remaining = new Set(processIds);
  while (remaining.size && Date.now() < deadline) {
    for (const pid of [...remaining]) {
      try {
        process.kill(pid, 0);
      } catch {
        remaining.delete(pid);
      }
    }
    if (remaining.size) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return [...remaining];
}

export async function stopTraeForRestart(exePath, { timeoutMs = 15000 } = {}) {
  const processIds = await findTraeProcessIds(exePath);
  if (!processIds.length) return [];

  const script = `
    $ids = @(${processIds.join(",")})
    Get-Process -Id $ids -ErrorAction SilentlyContinue | ForEach-Object {
      try { [void]$_.CloseMainWindow() } catch {}
    }
  `;
  await runPowerShell(script);
  let remaining = await waitForExit(processIds, timeoutMs);
  if (!remaining.length) return [];

  await new Promise((resolve) => setTimeout(resolve, 300));

  const forceScript = `
    $ids = @(${remaining.join(",")})
    Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue
  `;
  await runPowerShell(forceScript);
  remaining = await waitForExit(remaining, 5000);
  if (remaining.length) {
    throw new Error(`Unable to stop TRAE SOLO CN process(es): ${remaining.join(", ")}`);
  }
  return [];
}

export async function startTraeWithCdp(exePath, port) {
  const child = spawn(exePath, ["--new-window", `--remote-debugging-port=${port}`], {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return child.pid || null;
}

export async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTraeCdpAvailable(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

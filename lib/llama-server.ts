import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, truncateSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type LlamaServerConfig = {
  serverExe: string;
  modelPath: string;
  host: string;
  port: number;
  ctxSize: number;
  gpuLayers: string;
  maxTokens: number;
  temperature: number;
  extraPath: string;
  systemPrompt: string;
};

type LlamaServerState = {
  process: ChildProcessWithoutNullStreams | null;
  config: LlamaServerConfig | null;
  stdoutPath: string;
  stderrPath: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __gemma4LlamaServerState: LlamaServerState | undefined;
}

const state: LlamaServerState =
  globalThis.__gemma4LlamaServerState ??
  (globalThis.__gemma4LlamaServerState = {
    process: null,
    config: null,
    stdoutPath: path.resolve(process.cwd(), "logs", "llama-server-web.stdout.log"),
    stderrPath: path.resolve(process.cwd(), "logs", "llama-server-web.stderr.log"),
  });

export function getRepoRoot() {
  return process.cwd();
}

export function getWorkRoot() {
  return path.resolve(getRepoRoot(), "../Work");
}

function detectWinlibsBin() {
  const packagesRoot = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages"
  );

  if (!existsSync(packagesRoot)) return "";

  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const entries = fs
      .readdirSync(packagesRoot, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.startsWith("BrechtSanders.WinLibs.POSIX.UCRT_")
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const entry of entries) {
      const candidate = path.join(packagesRoot, entry, "mingw64", "bin");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return "";
  }

  return "";
}

function detectVulkanBin() {
  const sdkRoot = "C:\\VulkanSDK";
  if (!existsSync(sdkRoot)) return "";

  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const entries = fs
      .readdirSync(sdkRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const entry of entries) {
      const candidate = path.join(sdkRoot, entry, "Bin");
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return "";
  }

  return "";
}

export function getDefaultServerConfig(): LlamaServerConfig {
  const extra = [detectWinlibsBin(), detectVulkanBin()].filter(Boolean).join(";");

  return {
    serverExe: path.join(getWorkRoot(), "src", "llama.cpp", "build-mingw-vulkan", "bin", "llama-server.exe"),
    modelPath: path.join(getWorkRoot(), "models", "gemma4-e2b", "gemma-4-E2B-it-Q8_0.gguf"),
    host: "127.0.0.1",
    port: 8081,
    ctxSize: 4096,
    gpuLayers: "all",
    maxTokens: 256,
    temperature: 0,
    extraPath: extra,
    systemPrompt:
      "You are a concise and practical local assistant. Answer clearly, avoid filler, and prioritize fast useful output.",
  };
}

function getHealthUrl(config: Pick<LlamaServerConfig, "host" | "port">) {
  return `http://${config.host}:${config.port}/health`;
}

function isTrackedProcessRunning() {
  return Boolean(state.process && state.process.exitCode === null && !state.process.killed);
}

function normalizeConfig(input?: Partial<LlamaServerConfig>): LlamaServerConfig {
  const defaults = getDefaultServerConfig();
  return {
    ...defaults,
    ...input,
    port: Number(input?.port ?? defaults.port),
    ctxSize: Number(input?.ctxSize ?? defaults.ctxSize),
    maxTokens: Number(input?.maxTokens ?? defaults.maxTokens),
    temperature: Number(input?.temperature ?? defaults.temperature),
  };
}

async function pingHealth(config: Pick<LlamaServerConfig, "host" | "port">) {
  try {
    const response = await fetch(getHealthUrl(config), { cache: "no-store" });
    if (!response.ok) return { ok: false, body: null };
    const body = (await response.json()) as Record<string, unknown>;
    return { ok: true, body };
  } catch {
    return { ok: false, body: null };
  }
}

export function tailServerLog(kind: "stdout" | "stderr", lines = 40) {
  const target = kind === "stdout" ? state.stdoutPath : state.stderrPath;
  if (!existsSync(target)) return "";
  const text = readFileSync(target, "utf8");
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

export async function getServerStatus(input?: Partial<LlamaServerConfig>) {
  const config = normalizeConfig(input);
  const health = await pingHealth(config);

  return {
    running: isTrackedProcessRunning(),
    reachable: health.ok,
    health: health.body,
    config,
    stdoutPath: state.stdoutPath,
    stderrPath: state.stderrPath,
  };
}

export async function startServer(input?: Partial<LlamaServerConfig>) {
  const config = normalizeConfig(input);

  if (isTrackedProcessRunning()) {
    return {
      ok: true,
      message: `llama-server is already running on ${getHealthUrl(config)}.`,
      status: await getServerStatus(config),
    };
  }

  const existing = await pingHealth(config);
  if (existing.ok) {
    state.config = config;
    return {
      ok: true,
      message: `An external llama-server is already reachable on ${getHealthUrl(config)}.`,
      status: await getServerStatus(config),
    };
  }

  if (!existsSync(config.serverExe)) {
    return { ok: false, message: `llama-server.exe not found: ${config.serverExe}` };
  }

  if (!existsSync(config.modelPath)) {
    return { ok: false, message: `Model file not found: ${config.modelPath}` };
  }

  ensureEmptyFile(state.stdoutPath);
  ensureEmptyFile(state.stderrPath);

  const env = { ...process.env };
  if (config.extraPath.trim()) {
    env.PATH = `${config.extraPath};${env.PATH ?? ""}`;
  }

  const stdoutFd = openSync(state.stdoutPath, "w");
  const stderrFd = openSync(state.stderrPath, "w");

  const child = spawn(
    config.serverExe,
    [
      "--host",
      config.host,
      "--port",
      String(config.port),
      "-m",
      config.modelPath,
      "-dev",
      "Vulkan0",
      "-ngl",
      config.gpuLayers,
      "-c",
      String(config.ctxSize),
      "--jinja",
      "--reasoning",
      "off",
      "--reasoning-format",
      "none",
      "--no-webui",
    ],
    {
      cwd: getRepoRoot(),
      env,
      stdio: ["ignore", stdoutFd, stderrFd],
      windowsHide: true,
    }
  );

  closeSync(stdoutFd);
  closeSync(stderrFd);

  state.process = child as ChildProcessWithoutNullStreams;
  state.config = config;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(1000);

    if (!isTrackedProcessRunning()) {
      const stderrTail = tailServerLog("stderr");
      state.process = null;
      return {
        ok: false,
        message: `llama-server exited during startup.\n\n${stderrTail || "(no stderr output)"}`,
      };
    }

    const result = await pingHealth(config);
    if (result.ok) {
      return {
        ok: true,
        message: `llama-server is ready on ${getHealthUrl(config)}.`,
        status: await getServerStatus(config),
      };
    }
  }

  await stopServer();
  return {
    ok: false,
    message: "Timed out waiting for llama-server health check.",
  };
}

export async function stopServer() {
  if (!isTrackedProcessRunning()) {
    state.process = null;
    return { ok: true, message: "llama-server is not running." };
  }

  state.process?.kill();
  state.process = null;
  await sleep(800);
  return { ok: true, message: "llama-server stopped." };
}

function ensureEmptyFile(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    truncateSync(filePath, 0);
    return;
  }

  const fd = openSync(filePath, "w");
  closeSync(fd);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

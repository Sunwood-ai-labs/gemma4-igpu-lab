import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, truncateSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RuntimeKind = "llamacpp" | "ollama";

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

export type OllamaServerConfig = {
  serverExe: string;
  host: string;
  port: number;
  model: string;
  maxTokens: number;
  temperature: number;
  keepAlive: string;
  extraPath: string;
  systemPrompt: string;
};

export type RuntimeLabConfig = {
  selectedRuntime: RuntimeKind;
  llama: LlamaServerConfig;
  ollama: OllamaServerConfig;
};

export type RuntimeStatusResponse = {
  runtime: RuntimeKind;
  running: boolean;
  reachable: boolean;
  health: Record<string, unknown> | null;
  config: LlamaServerConfig | OllamaServerConfig;
  stdoutPath: string;
  stderrPath: string;
  backendLabel: string;
};

type RuntimeProcessState<TConfig> = {
  process: ChildProcessWithoutNullStreams | null;
  config: TConfig | null;
  stdoutPath: string;
  stderrPath: string;
};

type RuntimeState = {
  llamacpp: RuntimeProcessState<LlamaServerConfig>;
  ollama: RuntimeProcessState<OllamaServerConfig>;
};

declare global {
  // eslint-disable-next-line no-var
  var __gemma4RuntimeState: RuntimeState | undefined;
}

const state: RuntimeState =
  globalThis.__gemma4RuntimeState ??
  (globalThis.__gemma4RuntimeState = {
    llamacpp: {
      process: null,
      config: null,
      stdoutPath: path.resolve(process.cwd(), "logs", "llama-server-web.stdout.log"),
      stderrPath: path.resolve(process.cwd(), "logs", "llama-server-web.stderr.log"),
    },
    ollama: {
      process: null,
      config: null,
      stdoutPath: path.resolve(process.cwd(), "logs", "ollama-serve-web.stdout.log"),
      stderrPath: path.resolve(process.cwd(), "logs", "ollama-serve-web.stderr.log"),
    },
  });

export function getRepoRoot() {
  return process.cwd();
}

export function getWorkRoot() {
  return path.resolve(getRepoRoot(), "../Work");
}

export function getRuntimeLabel(runtime: RuntimeKind) {
  return runtime === "llamacpp" ? "llama.cpp + Vulkan" : "Ollama";
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

function detectOllamaExe() {
  const candidate = path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Programs",
    "Ollama",
    "ollama.exe"
  );

  return existsSync(candidate) ? candidate : "ollama";
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

export function getDefaultOllamaConfig(): OllamaServerConfig {
  return {
    serverExe: detectOllamaExe(),
    host: "127.0.0.1",
    port: 11434,
    model: "gemma4e2b-q8-local:latest",
    maxTokens: 256,
    temperature: 0,
    keepAlive: "30m",
    extraPath: "",
    systemPrompt:
      "You are a concise and practical local assistant. Answer clearly, avoid filler, and prioritize fast useful output.",
  };
}

export function getDefaultLabConfig(): RuntimeLabConfig {
  return {
    selectedRuntime: "llamacpp",
    llama: getDefaultServerConfig(),
    ollama: getDefaultOllamaConfig(),
  };
}

function normalizeLlamaConfig(input?: Partial<LlamaServerConfig>): LlamaServerConfig {
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

function normalizeOllamaConfig(input?: Partial<OllamaServerConfig>): OllamaServerConfig {
  const defaults = getDefaultOllamaConfig();
  return {
    ...defaults,
    ...input,
    port: Number(input?.port ?? defaults.port),
    maxTokens: Number(input?.maxTokens ?? defaults.maxTokens),
    temperature: Number(input?.temperature ?? defaults.temperature),
  };
}

export function normalizeLabConfig(input?: Partial<RuntimeLabConfig>): RuntimeLabConfig {
  const defaults = getDefaultLabConfig();

  return {
    selectedRuntime:
      input?.selectedRuntime === "ollama" || input?.selectedRuntime === "llamacpp"
        ? input.selectedRuntime
        : defaults.selectedRuntime,
    llama: normalizeLlamaConfig(input?.llama),
    ollama: normalizeOllamaConfig(input?.ollama),
  };
}

export function getRuntimeConfig(
  config: RuntimeLabConfig,
  runtime: RuntimeKind
): LlamaServerConfig | OllamaServerConfig {
  return runtime === "llamacpp" ? config.llama : config.ollama;
}

function getHealthUrl(
  runtime: RuntimeKind,
  config: Pick<LlamaServerConfig, "host" | "port"> | Pick<OllamaServerConfig, "host" | "port">
) {
  const pathName = runtime === "llamacpp" ? "/health" : "/api/version";
  return `http://${config.host}:${config.port}${pathName}`;
}

function getProcessState(runtime: RuntimeKind) {
  return state[runtime];
}

function isTrackedProcessRunning(runtime: RuntimeKind) {
  const runtimeState = getProcessState(runtime);
  return Boolean(runtimeState.process && runtimeState.process.exitCode === null && !runtimeState.process.killed);
}

async function pingHealth(
  runtime: RuntimeKind,
  config: Pick<LlamaServerConfig, "host" | "port"> | Pick<OllamaServerConfig, "host" | "port">
) {
  try {
    const response = await fetch(getHealthUrl(runtime, config), { cache: "no-store" });
    if (!response.ok) return { ok: false, body: null };
    const body = (await response.json()) as Record<string, unknown>;
    return { ok: true, body };
  } catch {
    return { ok: false, body: null };
  }
}

export function tailServerLog(runtime: RuntimeKind, kind: "stdout" | "stderr", lines = 40) {
  const runtimeState = getProcessState(runtime);
  const target = kind === "stdout" ? runtimeState.stdoutPath : runtimeState.stderrPath;
  if (!existsSync(target)) return "";
  const text = readFileSync(target, "utf8");
  return text.split(/\r?\n/).slice(-lines).join("\n");
}

export async function getServerStatus(
  input?: Partial<RuntimeLabConfig>,
  runtimeInput?: RuntimeKind
): Promise<RuntimeStatusResponse> {
  const config = normalizeLabConfig(input);
  const runtime = runtimeInput ?? config.selectedRuntime;
  const runtimeConfig = getRuntimeConfig(config, runtime);
  const health = await pingHealth(runtime, runtimeConfig);
  const runtimeState = getProcessState(runtime);

  return {
    runtime,
    running: isTrackedProcessRunning(runtime),
    reachable: health.ok,
    health: health.body,
    config: runtimeConfig,
    stdoutPath: runtimeState.stdoutPath,
    stderrPath: runtimeState.stderrPath,
    backendLabel: getRuntimeLabel(runtime),
  };
}

export async function startServer(input?: Partial<RuntimeLabConfig>, runtimeInput?: RuntimeKind) {
  const config = normalizeLabConfig(input);
  const runtime = runtimeInput ?? config.selectedRuntime;

  return runtime === "llamacpp"
    ? startLlamaServer(config.llama)
    : startOllamaServer(config.ollama);
}

export async function stopServer(runtimeInput?: RuntimeKind | "all") {
  const runtimes: Array<RuntimeKind> =
    runtimeInput === "all" || runtimeInput === undefined
      ? ["llamacpp", "ollama"]
      : [runtimeInput];

  const stopped: string[] = [];

  for (const runtime of runtimes) {
    const runtimeState = getProcessState(runtime);
    if (isTrackedProcessRunning(runtime)) {
      runtimeState.process?.kill();
      stopped.push(getRuntimeLabel(runtime));
    }
    runtimeState.process = null;
  }

  await sleep(800);

  if (runtimeInput === "all" || runtimeInput === undefined) {
    return {
      ok: true,
      message:
        stopped.length > 0
          ? `Stopped tracked runtimes: ${stopped.join(", ")}.`
          : "No tracked runtimes were running.",
    };
  }

  return {
    ok: true,
    message:
      stopped.length > 0
        ? `${stopped[0]} stopped.`
        : `${getRuntimeLabel(runtimeInput)} is not running as a tracked process.`,
  };
}

async function startLlamaServer(config: LlamaServerConfig) {
  if (isTrackedProcessRunning("llamacpp")) {
    return {
      ok: true,
      message: `llama-server is already running on ${getHealthUrl("llamacpp", config)}.`,
      status: await getServerStatus({ selectedRuntime: "llamacpp", llama: config }, "llamacpp"),
    };
  }

  const existing = await pingHealth("llamacpp", config);
  if (existing.ok) {
    state.llamacpp.config = config;
    return {
      ok: true,
      message: `An external llama-server is already reachable on ${getHealthUrl("llamacpp", config)}.`,
      status: await getServerStatus({ selectedRuntime: "llamacpp", llama: config }, "llamacpp"),
    };
  }

  if (!existsSync(config.serverExe)) {
    return { ok: false, message: `llama-server.exe not found: ${config.serverExe}` };
  }

  if (!existsSync(config.modelPath)) {
    return { ok: false, message: `Model file not found: ${config.modelPath}` };
  }

  ensureEmptyFile(state.llamacpp.stdoutPath);
  ensureEmptyFile(state.llamacpp.stderrPath);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (config.extraPath.trim()) {
    env.PATH = `${config.extraPath};${env.PATH ?? ""}`;
  }

  const stdoutFd = openSync(state.llamacpp.stdoutPath, "w");
  const stderrFd = openSync(state.llamacpp.stderrPath, "w");

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

  state.llamacpp.process = child as ChildProcessWithoutNullStreams;
  state.llamacpp.config = config;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(1000);

    if (!isTrackedProcessRunning("llamacpp")) {
      const stderrTail = tailServerLog("llamacpp", "stderr");
      state.llamacpp.process = null;
      return {
        ok: false,
        message: `llama-server exited during startup.\n\n${stderrTail || "(no stderr output)"}`,
      };
    }

    const result = await pingHealth("llamacpp", config);
    if (result.ok) {
      return {
        ok: true,
        message: `llama-server is ready on ${getHealthUrl("llamacpp", config)}.`,
        status: await getServerStatus({ selectedRuntime: "llamacpp", llama: config }, "llamacpp"),
      };
    }
  }

  await stopServer("llamacpp");
  return {
    ok: false,
    message: "Timed out waiting for llama-server health check.",
  };
}

async function startOllamaServer(config: OllamaServerConfig) {
  if (isTrackedProcessRunning("ollama")) {
    return {
      ok: true,
      message: `Ollama is already running on ${getHealthUrl("ollama", config)}.`,
      status: await getServerStatus({ selectedRuntime: "ollama", ollama: config }, "ollama"),
    };
  }

  const existing = await pingHealth("ollama", config);
  if (existing.ok) {
    state.ollama.config = config;
    return {
      ok: true,
      message: `An external Ollama server is already reachable on ${getHealthUrl("ollama", config)}.`,
      status: await getServerStatus({ selectedRuntime: "ollama", ollama: config }, "ollama"),
    };
  }

  if (!existsSync(config.serverExe) && config.serverExe !== "ollama") {
    return { ok: false, message: `ollama.exe not found: ${config.serverExe}` };
  }

  ensureEmptyFile(state.ollama.stdoutPath);
  ensureEmptyFile(state.ollama.stderrPath);

  const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: `${config.host}:${config.port}` };
  if (config.extraPath.trim()) {
    env.PATH = `${config.extraPath};${env.PATH ?? ""}`;
  }

  const stdoutFd = openSync(state.ollama.stdoutPath, "w");
  const stderrFd = openSync(state.ollama.stderrPath, "w");

  const child = spawn(config.serverExe, ["serve"], {
    cwd: getRepoRoot(),
    env,
    stdio: ["ignore", stdoutFd, stderrFd],
    windowsHide: true,
  });

  closeSync(stdoutFd);
  closeSync(stderrFd);

  state.ollama.process = child as ChildProcessWithoutNullStreams;
  state.ollama.config = config;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(1000);

    if (!isTrackedProcessRunning("ollama")) {
      const stderrTail = tailServerLog("ollama", "stderr");
      state.ollama.process = null;
      return {
        ok: false,
        message: `Ollama exited during startup.\n\n${stderrTail || "(no stderr output)"}`,
      };
    }

    const result = await pingHealth("ollama", config);
    if (result.ok) {
      return {
        ok: true,
        message: `Ollama is ready on ${getHealthUrl("ollama", config)}.`,
        status: await getServerStatus({ selectedRuntime: "ollama", ollama: config }, "ollama"),
      };
    }
  }

  await stopServer("ollama");
  return {
    ok: false,
    message: "Timed out waiting for Ollama health check.",
  };
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

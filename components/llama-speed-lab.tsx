"use client";

import { Loader2, Play, Send, Sparkles, Square, TimerReset, Zap } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import type {
  LlamaServerConfig,
  OllamaServerConfig,
  RuntimeKind,
  RuntimeLabConfig,
  RuntimeStatusResponse,
} from "@/lib/llama-server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type RuntimeMetrics = {
  firstToken: string;
  promptTps: string;
  genTps: string;
  total: string;
  detail: string;
};

type RuntimePresence = {
  running: boolean;
  reachable: boolean;
  text: string;
};

type ComparisonRun = {
  metrics: RuntimeMetrics;
  prompt: string;
  model: string;
  measuredAt: string;
};

const QUICK_PROMPTS = [
  "Write one short sentence about RAM.",
  "Explain RAM in exactly three short bullet points.",
  "Give three short tips for making local LLM inference feel faster on a low-end GPU.",
  "Explain what a Python dictionary is in plain language and show one tiny example.",
];

const RUNTIMES: RuntimeKind[] = ["llamacpp", "ollama"];

const EMPTY_METRICS: RuntimeMetrics = {
  firstToken: "--",
  promptTps: "--",
  genTps: "--",
  total: "--",
  detail: "Send a prompt to capture timings.",
};

const RUNTIME_META: Record<
  RuntimeKind,
  {
    label: string;
    short: string;
    description: string;
  }
> = {
  llamacpp: {
    label: "llama.cpp + Vulkan",
    short: "llama.cpp",
    description: "Fastest local path on this PC with the Q8_0 GGUF.",
  },
  ollama: {
    label: "Ollama",
    short: "Ollama",
    description: "Simpler local runtime with model management built in.",
  },
};

export function LlamaSpeedLab({ initialConfig }: { initialConfig: RuntimeLabConfig }) {
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeKind>(initialConfig.selectedRuntime);
  const [configs, setConfigs] = useState<Omit<RuntimeLabConfig, "selectedRuntime">>({
    llama: initialConfig.llama,
    ollama: initialConfig.ollama,
  });
  const [messagesByRuntime, setMessagesByRuntime] = useState<Record<RuntimeKind, Message[]>>({
    llamacpp: [],
    ollama: [],
  });
  const [statusByRuntime, setStatusByRuntime] = useState<Record<RuntimeKind, RuntimePresence>>({
    llamacpp: { running: false, reachable: false, text: "Checking local runtime..." },
    ollama: { running: false, reachable: false, text: "Checking local runtime..." },
  });
  const [metricsByRuntime, setMetricsByRuntime] = useState<Record<RuntimeKind, RuntimeMetrics>>({
    llamacpp: { ...EMPTY_METRICS },
    ollama: { ...EMPTY_METRICS },
  });
  const [comparisonRuns, setComparisonRuns] = useState<Partial<Record<RuntimeKind, ComparisonRun>>>(
    {}
  );
  const [draft, setDraft] = useState(QUICK_PROMPTS[0]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPending, startTransition] = useTransition();

  const currentMessages = messagesByRuntime[selectedRuntime];
  const currentStatus = statusByRuntime[selectedRuntime];
  const currentMetrics = metricsByRuntime[selectedRuntime];
  const currentRuntimeMeta = RUNTIME_META[selectedRuntime];
  const promptCount = useMemo(
    () => currentMessages.filter((message) => message.role === "user").length,
    [currentMessages]
  );

  useEffect(() => {
    void refreshStatus(false, selectedRuntime);
  }, [selectedRuntime]);

  function buildConfigPayload(runtime = selectedRuntime): RuntimeLabConfig {
    return {
      selectedRuntime: runtime,
      llama: configs.llama,
      ollama: configs.ollama,
    };
  }

  async function refreshStatus(showBusy = true, runtime = selectedRuntime) {
    if (showBusy) {
      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: { ...current[runtime], text: `Checking ${RUNTIME_META[runtime].label}...` },
      }));
    }

    try {
      const response = await fetch("/api/server/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtime, config: buildConfigPayload(runtime) }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await response.text());

      const payload = (await response.json()) as RuntimeStatusResponse;

      setConfigs((current) =>
        runtime === "llamacpp"
          ? { ...current, llama: payload.config as LlamaServerConfig }
          : { ...current, ollama: payload.config as OllamaServerConfig }
      );

      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: {
          running: payload.running,
          reachable: payload.reachable,
          text: payload.reachable
            ? `Ready on http://${payload.config.host}:${payload.config.port}`
            : `${payload.backendLabel} is not reachable yet.`,
        },
      }));
    } catch (error) {
      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: {
          ...current[runtime],
          running: false,
          reachable: false,
          text: error instanceof Error ? error.message : "Failed to query runtime status.",
        },
      }));
    }
  }

  async function startServer() {
    const runtime = selectedRuntime;

    setStatusByRuntime((current) => ({
      ...current,
      [runtime]: { ...current[runtime], text: `Starting ${RUNTIME_META[runtime].label}...` },
    }));

    try {
      const response = await fetch("/api/server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtime, config: buildConfigPayload(runtime) }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message: string;
        status?: RuntimeStatusResponse;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.message);

      if (payload.status) {
        setConfigs((current) =>
          runtime === "llamacpp"
            ? { ...current, llama: payload.status?.config as LlamaServerConfig }
            : { ...current, ollama: payload.status?.config as OllamaServerConfig }
        );
        setStatusByRuntime((current) => ({
          ...current,
          [runtime]: {
            running: payload.status?.running ?? current[runtime].running,
            reachable: payload.status?.reachable ?? current[runtime].reachable,
            text: payload.message,
          },
        }));
      }
    } catch (error) {
      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: {
          ...current[runtime],
          text: error instanceof Error ? error.message : `Failed to start ${RUNTIME_META[runtime].short}.`,
        },
      }));
    }
  }

  async function stopServer() {
    const runtime = selectedRuntime;

    setStatusByRuntime((current) => ({
      ...current,
      [runtime]: { ...current[runtime], text: `Stopping ${RUNTIME_META[runtime].label}...` },
    }));

    try {
      const response = await fetch("/api/server/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtime }),
      });
      const payload = (await response.json()) as { ok: boolean; message: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message);

      await refreshStatus(false, runtime);
      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: { ...current[runtime], text: payload.message },
      }));
    } catch (error) {
      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: {
          ...current[runtime],
          text: error instanceof Error ? error.message : `Failed to stop ${RUNTIME_META[runtime].short}.`,
        },
      }));
    }
  }

  function updateLlamaConfig<K extends keyof LlamaServerConfig>(key: K, value: LlamaServerConfig[K]) {
    setConfigs((current) => ({ ...current, llama: { ...current.llama, [key]: value } }));
  }

  function updateOllamaConfig<K extends keyof OllamaServerConfig>(
    key: K,
    value: OllamaServerConfig[K]
  ) {
    setConfigs((current) => ({ ...current, ollama: { ...current.ollama, [key]: value } }));
  }

  function resetMetrics(runtime: RuntimeKind) {
    setMetricsByRuntime((current) => ({
      ...current,
      [runtime]: { ...EMPTY_METRICS, detail: "Streaming..." },
    }));
  }

  async function sendPrompt() {
    const runtime = selectedRuntime;
    const content = draft.trim();
    if (!content || isStreaming) return;

    setIsStreaming(true);
    resetMetrics(runtime);
    setStatusByRuntime((current) => ({
      ...current,
      [runtime]: { ...current[runtime], text: `Streaming from ${RUNTIME_META[runtime].label}...` },
    }));

    const nextMessages = [...messagesByRuntime[runtime], { role: "user" as const, content }];
    setMessagesByRuntime((current) => ({
      ...current,
      [runtime]: [...nextMessages, { role: "assistant", content: "" }],
    }));
    setDraft("");

    const requestStarted = performance.now();
    let firstTokenRecorded = false;
    let firstTokenElapsed = "--";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runtime, config: buildConfigPayload(runtime), messages: nextMessages }),
      });

      if (!response.ok || !response.body) {
        const problem = await response.text();
        throw new Error(problem || "Chat route failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6));

          for (const line of lines) {
            if (line === "[DONE]") continue;

            const packet = JSON.parse(line) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              timings?: { prompt_per_second?: number; predicted_per_second?: number };
            };

            const chunk = packet.choices?.[0]?.delta?.content ?? "";
            if (chunk) {
              if (!firstTokenRecorded) {
                firstTokenRecorded = true;
                firstTokenElapsed = `${((performance.now() - requestStarted) / 1000).toFixed(2)}s`;
                setMetricsByRuntime((current) => ({
                  ...current,
                  [runtime]: { ...current[runtime], firstToken: firstTokenElapsed },
                }));
              }

              setMessagesByRuntime((current) => {
                const clone = [...current[runtime]];
                const last = clone.at(-1);
                if (last && last.role === "assistant") {
                  clone[clone.length - 1] = { ...last, content: last.content + chunk };
                }
                return { ...current, [runtime]: clone };
              });
            }

            if (packet.usage && packet.timings) {
              const nextMetrics: RuntimeMetrics = {
                firstToken: firstTokenRecorded ? firstTokenElapsed : "--",
                promptTps:
                  packet.timings.prompt_per_second !== undefined
                    ? packet.timings.prompt_per_second.toFixed(2)
                    : "--",
                genTps:
                  packet.timings.predicted_per_second !== undefined
                    ? packet.timings.predicted_per_second.toFixed(2)
                    : "--",
                total: `${((performance.now() - requestStarted) / 1000).toFixed(2)}s`,
                detail: `prompt=${packet.usage.prompt_tokens ?? 0} · gen=${
                  packet.usage.completion_tokens ?? 0
                } · total=${packet.usage.total_tokens ?? 0}`,
              };

              setMetricsByRuntime((current) => ({ ...current, [runtime]: nextMetrics }));
              setComparisonRuns((current) => ({
                ...current,
                [runtime]: {
                  metrics: nextMetrics,
                  prompt: content,
                  model: getRuntimeModelLabel(runtime, configs),
                  measuredAt: new Date().toISOString(),
                },
              }));
            }
          }
        }
      }

      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: { ...current[runtime], text: "Stream complete." },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Streaming failed.";
      setStatusByRuntime((current) => ({
        ...current,
        [runtime]: { ...current[runtime], text: message },
      }));
      setMessagesByRuntime((current) => {
        const clone = [...current[runtime]];
        const last = clone.at(-1);
        if (last?.role === "assistant" && !last.content) {
          clone[clone.length - 1] = { role: "assistant", content: `Request failed: ${message}` };
        }
        return { ...current, [runtime]: clone };
      });
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {RUNTIMES.map((runtime) => (
            <Button
              key={runtime}
              data-testid={`runtime-${runtime}`}
              variant={selectedRuntime === runtime ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedRuntime(runtime)}
              disabled={isStreaming}
            >
              {RUNTIME_META[runtime].label}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Gemma 4 local runtime lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Switch between <span className="font-medium text-foreground">llama.cpp + Vulkan</span> and{" "}
            <span className="font-medium text-foreground">Ollama</span>, send the same prompt, and compare browser-side
            first-token latency plus throughput in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{currentRuntimeMeta.label}</Badge>
          <Badge variant="outline">{getRuntimeModelLabel(selectedRuntime, configs)}</Badge>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Zap className="size-4" />} label="First Token" value={currentMetrics.firstToken} />
        <MetricCard icon={<Sparkles className="size-4" />} label="Prompt tok/s" value={currentMetrics.promptTps} />
        <MetricCard icon={<Send className="size-4" />} label="Gen tok/s" value={currentMetrics.genTps} />
        <MetricCard icon={<TimerReset className="size-4" />} label="Total" value={currentMetrics.total} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Last Comparison</CardTitle>
          <CardDescription as="p">
            Run a prompt on each runtime and compare the latest browser-side numbers side by side.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {RUNTIMES.map((runtime) => (
            <ComparisonCard
              key={runtime}
              runtime={runtime}
              current={selectedRuntime === runtime}
              snapshot={comparisonRuns[runtime]}
            />
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Server</CardTitle>
              <CardDescription as="p">{currentRuntimeMeta.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={currentStatus.reachable ? "default" : "secondary"}>
                  {currentStatus.reachable ? "Reachable" : "Offline"}
                </Badge>
                <Badge variant="outline">
                  {currentStatus.running ? "Tracked process running" : "No tracked process"}
                </Badge>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p data-testid="status-text" className="font-mono text-xs leading-6 text-muted-foreground">
                  {currentStatus.text}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid="start-server-button"
                  onClick={() => startTransition(() => void startServer())}
                  disabled={isPending || isStreaming}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  Start
                </Button>
                <Button
                  data-testid="stop-server-button"
                  variant="outline"
                  onClick={() => startTransition(() => void stopServer())}
                  disabled={isPending || isStreaming}
                >
                  <Square className="size-4" />
                  Stop
                </Button>
                <Button
                  data-testid="refresh-server-button"
                  variant="outline"
                  onClick={() => startTransition(() => void refreshStatus())}
                  disabled={isPending || isStreaming}
                >
                  <TimerReset className="size-4" />
                  Refresh
                </Button>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {selectedRuntime === "llamacpp"
                  ? `${configs.llama.host}:${configs.llama.port}`
                  : `${configs.ollama.host}:${configs.ollama.port}`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Runtime Config</CardTitle>
              <CardDescription as="p">
                Adjust local settings for the selected runtime before you compare.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedRuntime === "llamacpp" ? (
                <>
                  <Field label="llama-server.exe">
                    <Input
                      value={configs.llama.serverExe}
                      onChange={(event) => updateLlamaConfig("serverExe", event.target.value)}
                    />
                  </Field>
                  <Field label="Model Path">
                    <Input
                      value={configs.llama.modelPath}
                      onChange={(event) => updateLlamaConfig("modelPath", event.target.value)}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Host">
                      <Input value={configs.llama.host} onChange={(event) => updateLlamaConfig("host", event.target.value)} />
                    </Field>
                    <Field label="Port">
                      <Input
                        value={String(configs.llama.port)}
                        onChange={(event) => updateLlamaConfig("port", Number(event.target.value || 0))}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Context">
                      <Input
                        value={String(configs.llama.ctxSize)}
                        onChange={(event) => updateLlamaConfig("ctxSize", Number(event.target.value || 0))}
                      />
                    </Field>
                    <Field label="GPU Layers">
                      <Input
                        value={configs.llama.gpuLayers}
                        onChange={(event) => updateLlamaConfig("gpuLayers", event.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Max Tokens">
                      <Input
                        value={String(configs.llama.maxTokens)}
                        onChange={(event) => updateLlamaConfig("maxTokens", Number(event.target.value || 0))}
                      />
                    </Field>
                    <Field label="Temperature">
                      <Input
                        value={String(configs.llama.temperature)}
                        onChange={(event) => updateLlamaConfig("temperature", Number(event.target.value || 0))}
                      />
                    </Field>
                  </div>
                  <Field label="Extra PATH">
                    <Input
                      value={configs.llama.extraPath}
                      onChange={(event) => updateLlamaConfig("extraPath", event.target.value)}
                    />
                  </Field>
                  <Field label="System Prompt">
                    <Textarea
                      value={configs.llama.systemPrompt}
                      onChange={(event) => updateLlamaConfig("systemPrompt", event.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="ollama.exe">
                    <Input
                      value={configs.ollama.serverExe}
                      onChange={(event) => updateOllamaConfig("serverExe", event.target.value)}
                    />
                  </Field>
                  <Field label="Model">
                    <Input
                      value={configs.ollama.model}
                      onChange={(event) => updateOllamaConfig("model", event.target.value)}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Host">
                      <Input
                        value={configs.ollama.host}
                        onChange={(event) => updateOllamaConfig("host", event.target.value)}
                      />
                    </Field>
                    <Field label="Port">
                      <Input
                        value={String(configs.ollama.port)}
                        onChange={(event) => updateOllamaConfig("port", Number(event.target.value || 0))}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Max Tokens">
                      <Input
                        value={String(configs.ollama.maxTokens)}
                        onChange={(event) => updateOllamaConfig("maxTokens", Number(event.target.value || 0))}
                      />
                    </Field>
                    <Field label="Temperature">
                      <Input
                        value={String(configs.ollama.temperature)}
                        onChange={(event) => updateOllamaConfig("temperature", Number(event.target.value || 0))}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Keep Alive">
                      <Input
                        value={configs.ollama.keepAlive}
                        onChange={(event) => updateOllamaConfig("keepAlive", event.target.value)}
                      />
                    </Field>
                    <Field label="Extra PATH">
                      <Input
                        value={configs.ollama.extraPath}
                        onChange={(event) => updateOllamaConfig("extraPath", event.target.value)}
                      />
                    </Field>
                  </div>
                  <Field label="System Prompt">
                    <Textarea
                      value={configs.ollama.systemPrompt}
                      onChange={(event) => updateOllamaConfig("systemPrompt", event.target.value)}
                    />
                  </Field>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Chat</CardTitle>
            <CardDescription as="p">
              Send the same prompt to each runtime and compare the streamed response plus exact timings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <Button key={prompt} variant="outline" size="sm" onClick={() => setDraft(prompt)} type="button" className="h-auto whitespace-normal text-left">
                  {prompt}
                </Button>
              ))}
            </div>
            <Textarea
              data-testid="prompt-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask something short to compare runtimes..."
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div data-testid="metrics-detail" className="font-mono text-xs text-muted-foreground">
                {currentMetrics.detail}
              </div>
              <Button
                data-testid="send-prompt-button"
                onClick={sendPrompt}
                disabled={isStreaming || !currentStatus.reachable}
              >
                {isStreaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {isStreaming ? "Streaming..." : `Send to ${currentRuntimeMeta.short}`}
              </Button>
            </div>
            <Separator />
            <div data-testid="chat-stream" className="max-h-[540px] space-y-4 overflow-y-auto rounded-md border bg-background p-4">
              {currentMessages.length === 0 ? (
                <EmptyState />
              ) : (
                currentMessages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {message.role === "user" ? "You" : currentRuntimeMeta.short}
                    </div>
                    <div
                      className={
                        message.role === "user"
                          ? "rounded-md bg-muted px-3 py-3 text-sm leading-6 text-foreground"
                          : "rounded-md border bg-card px-3 py-3 font-mono text-sm leading-6 text-card-foreground"
                      }
                    >
                      {message.content || (isStreaming && index === currentMessages.length - 1 ? "..." : "")}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                {promptCount} prompt{promptCount === 1 ? "" : "s"} sent on {currentRuntimeMeta.short}
              </span>
              <span>Local-only flow</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const testId = `metric-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;

  return (
    <Card className="shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div data-testid={testId} className="font-mono text-2xl font-semibold">
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonCard({
  runtime,
  snapshot,
  current,
}: {
  runtime: RuntimeKind;
  snapshot?: ComparisonRun;
  current: boolean;
}) {
  return (
    <Card data-testid={`comparison-${runtime}`} className={current ? "border-foreground/20" : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle as="h3">{RUNTIME_META[runtime].label}</CardTitle>
            <CardDescription as="p">{snapshot ? snapshot.model : "No run yet."}</CardDescription>
          </div>
          {current ? <Badge>Current</Badge> : <Badge variant="outline">Standby</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {snapshot ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <StatLine label="First Token" value={snapshot.metrics.firstToken} />
              <StatLine label="Prompt tok/s" value={snapshot.metrics.promptTps} />
              <StatLine label="Gen tok/s" value={snapshot.metrics.genTps} />
              <StatLine label="Total" value={snapshot.metrics.total} />
            </div>
            <p className="font-mono text-xs text-muted-foreground">{snapshot.metrics.detail}</p>
            <p className="text-xs text-muted-foreground">{snapshot.prompt}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run a prompt on {RUNTIME_META[runtime].short} to capture a comparison snapshot.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/20 px-6 text-center">
      <div className="rounded-md bg-muted p-3 text-muted-foreground">
        <Zap className="size-5" />
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Start with a short prompt</h3>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Switch between `llama.cpp` and `Ollama`, run the same prompt, and compare how each local runtime feels on this PC.
        </p>
      </div>
    </div>
  );
}

function getRuntimeModelLabel(
  runtime: RuntimeKind,
  configs: Pick<RuntimeLabConfig, "llama" | "ollama">
) {
  if (runtime === "llamacpp") {
    return configs.llama.modelPath.split(/[\\/]/).at(-1) ?? configs.llama.modelPath;
  }

  return configs.ollama.model;
}

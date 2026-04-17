"use client";

import { Loader2, Play, Send, Sparkles, Square, TimerReset, Zap } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type ServerConfig = {
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

type StatusResponse = {
  running: boolean;
  reachable: boolean;
  config: ServerConfig;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

const QUICK_PROMPTS = [
  "Write one short sentence about RAM.",
  "Explain RAM in exactly three short bullet points.",
  "Give three short tips for making local LLM inference feel faster on a low-end GPU.",
  "Explain what a Python dictionary is in plain language and show one tiny example.",
];

export function LlamaSpeedLab({ initialConfig }: { initialConfig: ServerConfig }) {
  const [config, setConfig] = useState<ServerConfig>(initialConfig);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(QUICK_PROMPTS[0]);
  const [statusText, setStatusText] = useState("Checking local server...");
  const [serverRunning, setServerRunning] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [metrics, setMetrics] = useState({
    firstToken: "--",
    promptTps: "--",
    genTps: "--",
    total: "--",
    detail: "Send a prompt to capture timings.",
  });
  const [isPending, startTransition] = useTransition();

  const promptCount = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);

  useEffect(() => {
    void refreshStatus(false);
  }, []);

  async function refreshStatus(showBusy = true) {
    if (showBusy) setStatusText("Checking llama.cpp server...");

    try {
      const response = await fetch("/api/server/status", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());

      const payload = (await response.json()) as StatusResponse;
      setServerRunning(payload.running);
      setServerReachable(payload.reachable);
      setConfig(payload.config);
      setStatusText(
        payload.reachable
          ? `Ready on http://${payload.config.host}:${payload.config.port}`
          : "Server is not reachable yet."
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to query server status.");
      setServerRunning(false);
      setServerReachable(false);
    }
  }

  async function startServer() {
    setStatusText("Starting llama.cpp + Vulkan...");

    try {
      const response = await fetch("/api/server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const payload = (await response.json()) as { ok: boolean; message: string; status?: StatusResponse };
      if (!response.ok || !payload.ok) throw new Error(payload.message);

      if (payload.status) {
        setServerRunning(payload.status.running);
        setServerReachable(payload.status.reachable);
        setConfig(payload.status.config);
      }
      setStatusText(payload.message);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to start llama.cpp.");
    }
  }

  async function stopServer() {
    setStatusText("Stopping llama.cpp server...");

    try {
      const response = await fetch("/api/server/stop", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; message: string };
      if (!response.ok || !payload.ok) throw new Error(payload.message);

      setServerRunning(false);
      setServerReachable(false);
      setStatusText(payload.message);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to stop llama.cpp.");
    }
  }

  function updateConfig<K extends keyof ServerConfig>(key: K, value: ServerConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function resetMetrics() {
    setMetrics({
      firstToken: "--",
      promptTps: "--",
      genTps: "--",
      total: "--",
      detail: "Streaming...",
    });
  }

  async function sendPrompt() {
    const content = draft.trim();
    if (!content || isStreaming) return;

    setIsStreaming(true);
    resetMetrics();
    setStatusText("Streaming from llama.cpp...");

    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);
    setDraft("");

    const requestStarted = performance.now();
    let firstTokenRecorded = false;
    let firstTokenElapsed = "--";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, messages: nextMessages }),
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
                setMetrics((current) => ({
                  ...current,
                  firstToken: firstTokenElapsed,
                }));
              }

              setMessages((current) => {
                const clone = [...current];
                const last = clone.at(-1);
                if (last && last.role === "assistant") {
                  clone[clone.length - 1] = { ...last, content: last.content + chunk };
                }
                return clone;
              });
            }

            if (packet.usage && packet.timings) {
              setMetrics({
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
              });
            }
          }
        }
      }

      setStatusText("Stream complete.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Streaming failed.";
      setStatusText(message);
      setMessages((current) => {
        const clone = [...current];
        const last = clone.at(-1);
        if (last?.role === "assistant" && !last.content) {
          clone[clone.length - 1] = { role: "assistant", content: `Request failed: ${message}` };
        }
        return clone;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">llama.cpp</Badge>
          <Badge variant="outline">Vulkan0</Badge>
          <Badge variant="outline">Gemma 4 E2B Q8_0</Badge>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Gemma 4 iGPU speed lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            A small local dashboard for starting <span className="font-medium text-foreground">llama.cpp + Vulkan</span>, sending a short prompt, and checking
            first-token latency plus generation throughput in one place.
          </p>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Zap className="size-4" />} label="First Token" value={metrics.firstToken} />
        <MetricCard icon={<Sparkles className="size-4" />} label="Prompt tok/s" value={metrics.promptTps} />
        <MetricCard icon={<Send className="size-4" />} label="Gen tok/s" value={metrics.genTps} />
        <MetricCard icon={<TimerReset className="size-4" />} label="Total" value={metrics.total} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Server</CardTitle>
              <CardDescription as="p">Start or stop the local llama-server process.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={serverReachable ? "default" : "secondary"}>
                  {serverReachable ? "Reachable" : "Offline"}
                </Badge>
                <Badge variant="outline">{serverRunning ? "Tracked process running" : "No tracked process"}</Badge>
              </div>
              <div className="rounded-md border bg-muted/40 p-3">
                <p data-testid="status-text" className="font-mono text-xs leading-6 text-muted-foreground">
                  {statusText}
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
                {config.host}:{config.port}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">Runtime Config</CardTitle>
              <CardDescription as="p">Adjust local paths and generation settings if needed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="llama-server.exe">
                <Input value={config.serverExe} onChange={(event) => updateConfig("serverExe", event.target.value)} />
              </Field>
              <Field label="Model Path">
                <Input value={config.modelPath} onChange={(event) => updateConfig("modelPath", event.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Host">
                  <Input value={config.host} onChange={(event) => updateConfig("host", event.target.value)} />
                </Field>
                <Field label="Port">
                  <Input value={String(config.port)} onChange={(event) => updateConfig("port", Number(event.target.value || 0))} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Context">
                  <Input value={String(config.ctxSize)} onChange={(event) => updateConfig("ctxSize", Number(event.target.value || 0))} />
                </Field>
                <Field label="GPU Layers">
                  <Input value={config.gpuLayers} onChange={(event) => updateConfig("gpuLayers", event.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Max Tokens">
                  <Input value={String(config.maxTokens)} onChange={(event) => updateConfig("maxTokens", Number(event.target.value || 0))} />
                </Field>
                <Field label="Temperature">
                  <Input value={String(config.temperature)} onChange={(event) => updateConfig("temperature", Number(event.target.value || 0))} />
                </Field>
              </div>
              <Field label="Extra PATH">
                <Input value={config.extraPath} onChange={(event) => updateConfig("extraPath", event.target.value)} />
              </Field>
              <Field label="System Prompt">
                <Textarea value={config.systemPrompt} onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
              </Field>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle as="h2">Chat</CardTitle>
            <CardDescription as="p">Send a short prompt and watch the streamed response plus exact timings.</CardDescription>
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
              placeholder="Ask something short to feel the stream speed..."
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div data-testid="metrics-detail" className="font-mono text-xs text-muted-foreground">
                {metrics.detail}
              </div>
              <Button data-testid="send-prompt-button" onClick={sendPrompt} disabled={isStreaming || !serverReachable}>
                {isStreaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {isStreaming ? "Streaming..." : "Send Prompt"}
              </Button>
            </div>
            <Separator />
            <div data-testid="chat-stream" className="max-h-[540px] space-y-4 overflow-y-auto rounded-md border bg-background p-4">
              {messages.length === 0 ? (
                <EmptyState />
              ) : (
                messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">
                      {message.role === "user" ? "You" : "llama.cpp"}
                    </div>
                    <div
                      className={
                        message.role === "user"
                          ? "rounded-md bg-muted px-3 py-3 text-sm leading-6 text-foreground"
                          : "rounded-md border bg-card px-3 py-3 font-mono text-sm leading-6 text-card-foreground"
                      }
                    >
                      {message.content || (isStreaming && index === messages.length - 1 ? "..." : "")}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>{promptCount} prompt{promptCount === 1 ? "" : "s"} sent</span>
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

function EmptyState() {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/20 px-6 text-center">
      <div className="rounded-md bg-muted p-3 text-muted-foreground">
        <Zap className="size-5" />
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-semibold">Start with a short prompt</h3>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Use the quick chips above and you&apos;ll immediately see how responsive `llama.cpp + Vulkan` feels on the local Intel iGPU.
        </p>
      </div>
    </div>
  );
}

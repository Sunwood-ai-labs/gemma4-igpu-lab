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
                setMetrics((current) => ({
                  ...current,
                  firstToken: `${((performance.now() - requestStarted) / 1000).toFixed(2)}s`,
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
                firstToken: firstTokenRecorded
                  ? `${((performance.now() - requestStarted) / 1000).toFixed(2)}s`
                  : "--",
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
    <main className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-8 px-4 py-6 md:px-8 lg:px-10">
      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden">
          <CardHeader className="gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>llama.cpp</Badge>
              <Badge variant="outline">Vulkan0</Badge>
              <Badge variant="outline">Gemma 4 E2B Q8_0</Badge>
            </div>
            <div className="space-y-3">
              <CardTitle className="max-w-3xl text-4xl leading-tight md:text-5xl">
                Feel the local iGPU speed in a browser, not a terminal.
              </CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">
                This dashboard is tuned for one thing: showcasing how fast <span className="font-medium text-foreground">llama.cpp + Vulkan</span> can
                feel on this PC. Start the server, fire a short prompt, and watch first-token latency and generation throughput update live.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-4">
            <MetricCard icon={<Zap className="size-4" />} label="First Token" value={metrics.firstToken} />
            <MetricCard icon={<Sparkles className="size-4" />} label="Prompt tok/s" value={metrics.promptTps} />
            <MetricCard icon={<Send className="size-4" />} label="Gen tok/s" value={metrics.genTps} />
            <MetricCard icon={<TimerReset className="size-4" />} label="Total" value={metrics.total} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server Pulse</CardTitle>
            <CardDescription>Start, stop, and verify the local llama-server without leaving the page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={serverReachable ? "default" : "secondary"}>
                {serverReachable ? "Reachable" : "Offline"}
              </Badge>
              <Badge variant="outline">{serverRunning ? "Tracked process running" : "No tracked process"}</Badge>
            </div>
            <div className="rounded-[24px] border border-border/70 bg-background/70 p-4">
              <p className="font-mono text-sm leading-6 text-muted-foreground">{statusText}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => startTransition(() => void startServer())} disabled={isPending || isStreaming}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Start Server
              </Button>
              <Button variant="outline" onClick={() => startTransition(() => void stopServer())} disabled={isPending || isStreaming}>
                <Square className="size-4" />
                Stop
              </Button>
              <Button variant="outline" onClick={() => startTransition(() => void refreshStatus())} disabled={isPending || isStreaming}>
                <TimerReset className="size-4" />
                Refresh
              </Button>
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              {config.host}:{config.port}
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card>
          <CardHeader>
            <CardTitle>Local Runtime Config</CardTitle>
            <CardDescription>The defaults point at this machine&apos;s current `llama.cpp` build and Gemma 4 model. Edit them if your paths differ.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field label="llama-server.exe">
              <Input value={config.serverExe} onChange={(event) => updateConfig("serverExe", event.target.value)} />
            </Field>
            <Field label="Model Path">
              <Input value={config.modelPath} onChange={(event) => updateConfig("modelPath", event.target.value)} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Host">
                <Input value={config.host} onChange={(event) => updateConfig("host", event.target.value)} />
              </Field>
              <Field label="Port">
                <Input value={String(config.port)} onChange={(event) => updateConfig("port", Number(event.target.value || 0))} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Context">
                <Input value={String(config.ctxSize)} onChange={(event) => updateConfig("ctxSize", Number(event.target.value || 0))} />
              </Field>
              <Field label="GPU Layers">
                <Input value={config.gpuLayers} onChange={(event) => updateConfig("gpuLayers", event.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
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
              <Textarea value={config.systemPrompt} onChange={(event) => updateConfig("systemPrompt", event.target.value)} className="min-h-32" />
            </Field>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Speed Chat</CardTitle>
            <CardDescription>Short prompts make the speed pop. The final SSE packet supplies the exact prompt and generation throughput.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  className="rounded-full border border-border/70 bg-background/70 px-3 py-2 text-left text-xs text-muted-foreground transition hover:border-ring/60 hover:text-foreground"
                  onClick={() => setDraft(prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask something short to feel the stream speed..." className="min-h-32" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-xs text-muted-foreground">{metrics.detail}</div>
              <Button onClick={sendPrompt} disabled={isStreaming || !serverReachable} size="lg">
                {isStreaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {isStreaming ? "Streaming..." : "Send Prompt"}
              </Button>
            </div>
            <Separator />
            <div className="max-h-[560px] space-y-4 overflow-y-auto rounded-[24px] border border-border/70 bg-background/60 p-4">
              {messages.length === 0 ? (
                <EmptyState />
              ) : (
                messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[85%]" : "mr-auto max-w-[90%]"}>
                    <div className="mb-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      {message.role === "user" ? "You" : "llama.cpp"}
                    </div>
                    <div
                      className={
                        message.role === "user"
                          ? "rounded-[24px] bg-foreground px-5 py-4 text-sm leading-7 text-background"
                          : "rounded-[24px] border border-border/60 bg-card px-5 py-4 font-mono text-sm leading-7 text-card-foreground"
                      }
                    >
                      {message.content || (isStreaming && index === messages.length - 1 ? "..." : "")}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{promptCount} prompt{promptCount === 1 ? "" : "s"} sent</span>
              <span>Local-only flow · No cloud roundtrip</span>
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
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-border/70 bg-background/70 p-5">
      <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-mono text-3xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-[28px] border border-dashed border-border/80 bg-card/50 px-6 text-center">
      <div className="rounded-full bg-accent p-3 text-accent-foreground">
        <Zap className="size-5" />
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Start with a short prompt</h3>
        <p className="max-w-md text-sm leading-7 text-muted-foreground">
          Use the quick chips above and you&apos;ll immediately see how responsive `llama.cpp + Vulkan` feels on the local Intel iGPU.
        </p>
      </div>
    </div>
  );
}

import { NextResponse } from "next/server";

import {
  getDefaultLabConfig,
  normalizeLabConfig,
  type RuntimeKind,
  type RuntimeLabConfig,
} from "@/lib/llama-server";

export const runtime = "nodejs";

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    runtime?: RuntimeKind;
    config?: Partial<RuntimeLabConfig>;
    messages: Message[];
  };

  const config = normalizeLabConfig(body.config ?? getDefaultLabConfig());
  const runtimeKind = body.runtime ?? config.selectedRuntime;

  if (runtimeKind === "ollama") {
    return proxyOllamaChat(config, body.messages ?? []);
  }

  return proxyLlamaChat(config, body.messages ?? []);
}

async function proxyLlamaChat(config: RuntimeLabConfig, messages: Message[]) {
  const llamaConfig = config.llama;

  const upstream = await fetch(`http://${llamaConfig.host}:${llamaConfig.port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer no-key",
    },
    body: JSON.stringify({
      model: "local-model",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: llamaConfig.systemPrompt }, ...messages],
      temperature: llamaConfig.temperature,
      max_tokens: llamaConfig.maxTokens,
      reasoning_format: "none",
    }),
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return NextResponse.json({ error: detail || "Failed to reach llama-server." }, { status: upstream.status || 500 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function proxyOllamaChat(config: RuntimeLabConfig, messages: Message[]) {
  const ollamaConfig = config.ollama;

  const upstream = await fetch(`http://${ollamaConfig.host}:${ollamaConfig.port}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ollamaConfig.model,
      stream: true,
      keep_alive: ollamaConfig.keepAlive,
      options: {
        temperature: ollamaConfig.temperature,
        num_predict: ollamaConfig.maxTokens,
      },
      messages: [{ role: "system", content: ollamaConfig.systemPrompt }, ...messages],
    }),
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return NextResponse.json({ error: detail || "Failed to reach Ollama." }, { status: upstream.status || 500 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let finalPacketSent = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const packet = JSON.parse(trimmed) as {
          done?: boolean;
          message?: { content?: string };
          prompt_eval_count?: number;
          prompt_eval_duration?: number;
          eval_count?: number;
          eval_duration?: number;
        };

        const chunk = packet.message?.content ?? "";
        if (chunk) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
            )
          );
        }

        if (packet.done && !finalPacketSent) {
          finalPacketSent = true;

          const promptTokens = packet.prompt_eval_count ?? 0;
          const completionTokens = packet.eval_count ?? 0;
          const promptSeconds = (packet.prompt_eval_duration ?? 0) / 1_000_000_000;
          const completionSeconds = (packet.eval_duration ?? 0) / 1_000_000_000;

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                usage: {
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  total_tokens: promptTokens + completionTokens,
                },
                timings: {
                  prompt_per_second:
                    promptTokens > 0 && promptSeconds > 0 ? promptTokens / promptSeconds : undefined,
                  predicted_per_second:
                    completionTokens > 0 && completionSeconds > 0
                      ? completionTokens / completionSeconds
                      : undefined,
                },
              })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            processLine(line);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);

        if (!finalPacketSent) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      } catch (error) {
        controller.error(error);
        return;
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

import { NextResponse } from "next/server";

import { type LlamaServerConfig, getDefaultServerConfig } from "@/lib/llama-server";

export const runtime = "nodejs";

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as {
    config?: Partial<LlamaServerConfig>;
    messages: Message[];
  };

  const defaults = getDefaultServerConfig();
  const config: LlamaServerConfig = {
    ...defaults,
    ...body.config,
    port: Number(body.config?.port ?? defaults.port),
    ctxSize: Number(body.config?.ctxSize ?? defaults.ctxSize),
    maxTokens: Number(body.config?.maxTokens ?? defaults.maxTokens),
    temperature: Number(body.config?.temperature ?? defaults.temperature),
  };

  const upstream = await fetch(`http://${config.host}:${config.port}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer no-key",
    },
    body: JSON.stringify({
      model: "local-model",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: config.systemPrompt }, ...(body.messages ?? [])],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
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

import { NextResponse } from "next/server";

import {
  startServer,
  normalizeLabConfig,
  type RuntimeKind,
  type RuntimeLabConfig,
} from "@/lib/llama-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runtime?: RuntimeKind;
    config?: Partial<RuntimeLabConfig>;
  };

  const config = normalizeLabConfig(body.config);
  const runtime = body.runtime ?? config.selectedRuntime;
  const result = await startServer(config, runtime);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

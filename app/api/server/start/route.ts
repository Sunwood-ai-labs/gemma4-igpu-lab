import { NextResponse } from "next/server";

import { startServer, type LlamaServerConfig } from "@/lib/llama-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<LlamaServerConfig>;
  const result = await startServer(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

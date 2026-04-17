import { NextResponse } from "next/server";

import { stopServer, type RuntimeKind } from "@/lib/llama-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runtime?: RuntimeKind | "all";
  };

  const result = await stopServer(body.runtime);
  return NextResponse.json(result);
}

import { NextResponse } from "next/server";

import {
  getDefaultLabConfig,
  getServerStatus,
  normalizeLabConfig,
  type RuntimeKind,
  type RuntimeLabConfig,
} from "@/lib/llama-server";

export const runtime = "nodejs";

export async function GET() {
  const defaults = getDefaultLabConfig();
  const status = await getServerStatus(defaults, defaults.selectedRuntime);
  return NextResponse.json(status);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runtime?: RuntimeKind;
    config?: Partial<RuntimeLabConfig>;
  };

  const config = normalizeLabConfig(body.config);
  const runtime = body.runtime ?? config.selectedRuntime;
  const status = await getServerStatus(config, runtime);
  return NextResponse.json(status);
}

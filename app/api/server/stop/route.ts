import { NextResponse } from "next/server";

import { stopServer } from "@/lib/llama-server";

export const runtime = "nodejs";

export async function POST() {
  const result = await stopServer();
  return NextResponse.json(result);
}

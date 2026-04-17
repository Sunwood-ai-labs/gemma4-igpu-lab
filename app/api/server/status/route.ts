import { NextResponse } from "next/server";

import { getServerStatus } from "@/lib/llama-server";

export const runtime = "nodejs";

export async function GET() {
  const status = await getServerStatus();
  return NextResponse.json(status);
}

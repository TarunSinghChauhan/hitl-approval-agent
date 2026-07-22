import { NextRequest, NextResponse } from "next/server";
import { submitTask } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = String(body?.input || "").trim();
    if (!input) {
      return NextResponse.json({ error: "input is required" }, { status: 400 });
    }
    const task = await submitTask(input);
    return NextResponse.json({ task });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

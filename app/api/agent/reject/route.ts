import { NextRequest, NextResponse } from "next/server";
import { rejectTask } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = String(body?.id || "");
    const note = body?.note ? String(body.note) : undefined;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const task = await rejectTask(id, note);
    return NextResponse.json({ task });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

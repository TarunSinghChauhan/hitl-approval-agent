// Thin wrapper around Groq's OpenAI-compatible chat-completions API.
// Groq's free tier requires no credit card and has no per-token charge —
// only rate limits — so this runs at genuinely zero cost.
// Get a free key at https://console.groq.com/keys

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callGroq(messages: ChatMessage[], jsonMode = false): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing GROQ_API_KEY. Get a free key at https://console.groq.com/keys and add it to .env"
    );
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      temperature: 0.3,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Groq returned an empty response");
  return content;
}

export interface AgentAssessment {
  proposedAction: string;
  reasoning: string;
  confidence: number; // 0.0 - 1.0
}

// Models sometimes report confidence as a percentage (60, "85%") or as text ("0.9").
// Clamping 60 to 1.0 would turn a 60%-sure answer into a certain one and auto-run it,
// so values above 1 are read as percentages up to 100, and anything unusable becomes
// 0, which pauses the task for a human. When in doubt, ask.
export function normalizeConfidence(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const text = value.trim();
    n = Number(text.replace(/%$/, ""));
    if (text.endsWith("%")) n /= 100; // "85%" -> 0.85
  } else {
    return 0;
  }
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return 0;
}

export async function assessTask(input: string): Promise<AgentAssessment> {
  const raw = await callGroq(
    [
      {
        role: "system",
        content: `You are an autonomous task-execution agent. Given a user's request, decide the single concrete action you would take to fulfill it, explain your reasoning, and rate your own confidence.

Be honest about uncertainty. Lower your confidence when:
- the request is ambiguous or could be interpreted multiple ways
- the action would be hard to reverse (sending something, deleting something, spending money, affecting a real person)
- you lack information needed to be sure the action is correct
- the request touches sensitive, legal, financial, or safety-related matters

Respond ONLY with a JSON object, no markdown, no preamble, in exactly this shape:
{"proposedAction": "string describing the concrete action", "reasoning": "string explaining your thinking", "confidence": number between 0 and 1}`,
      },
      { role: "user", content: input },
    ],
    true
  );

  try {
    const parsed = JSON.parse(raw);
    return {
      proposedAction: String(parsed.proposedAction ?? "").trim(),
      reasoning: String(parsed.reasoning ?? "").trim(),
      confidence: normalizeConfidence(parsed.confidence),
    };
  } catch {
    throw new Error(`Agent returned unparseable assessment: ${raw.slice(0, 300)}`);
  }
}

export async function executeAction(
  input: string,
  proposedAction: string,
  approvalNote?: string
): Promise<string> {
  const raw = await callGroq([
    {
      role: "system",
      content:
        "You are executing an approved action for an autonomous agent. Produce the final output/result of carrying out the proposed action. Be concrete and complete. Do not ask questions — deliver the result.",
    },
    {
      role: "user",
      content: `Original request: ${input}\n\nApproved action to carry out: ${proposedAction}${
        approvalNote ? `\n\nHuman reviewer note: ${approvalNote}` : ""
      }`,
    },
  ]);

  return raw.trim();
}
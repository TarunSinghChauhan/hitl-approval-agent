import { afterEach, describe, expect, it, vi } from "vitest";
import { assessTask, normalizeConfidence } from "../lib/llm";

describe("normalizeConfidence", () => {
  it.each([
    [0, 0], [0.5, 0.5], [0.75, 0.75], [1, 1],
    [60, 0.6], [85, 0.85], [100, 1],
    ["0.8", 0.8], ["85%", 0.85], [" 70 % ", 0.7], ["0.9%", 0.009],
  ])("reads %j as %j", (input, expected) => {
    expect(normalizeConfidence(input)).toBeCloseTo(expected as number, 10);
  });

  it.each([
    [-0.2], [-5], [101], [1000], [NaN], [Infinity], [-Infinity],
    [null], [undefined], [true], ["high"], [""], ["%"], [{}], [[0.9]],
  ])("treats %j as 0 so a human is asked", (input) => {
    expect(normalizeConfidence(input)).toBe(0);
  });

  it("never turns a percentage below the threshold into a certain answer", () => {
    // The old Math.min(1, n) made this 1, which auto-executed a 60%-sure action.
    expect(normalizeConfidence(60)).toBeLessThan(0.75);
  });
});

describe("assessTask", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function groqReplies(content: string, ok = true, status = 200) {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => ({
      ok,
      status,
      text: async () => content,
      json: async () => ({ choices: [{ message: { content } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns the assessment with confidence normalised", async () => {
    groqReplies(JSON.stringify({ proposedAction: " Send the email ", reasoning: "r", confidence: 60 }));
    const a = await assessTask("email my landlord");
    expect(a).toEqual({ proposedAction: "Send the email", reasoning: "r", confidence: 0.6 });
  });

  it("treats a missing confidence as 0", async () => {
    groqReplies(JSON.stringify({ proposedAction: "x", reasoning: "r" }));
    expect((await assessTask("x")).confidence).toBe(0);
  });

  it("fails without an API key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    await expect(assessTask("x")).rejects.toThrow(/Missing GROQ_API_KEY/);
  });

  it("surfaces an HTTP error from the model provider", async () => {
    groqReplies("rate limited", false, 429);
    await expect(assessTask("x")).rejects.toThrow(/Groq error 429/);
  });

  it("rejects an assessment that is not JSON", async () => {
    groqReplies("I think you should send it.");
    await expect(assessTask("x")).rejects.toThrow(/unparseable assessment/);
  });
});

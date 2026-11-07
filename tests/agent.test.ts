import { beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory stand-in for the Prisma Task table.
const db = vi.hoisted(() => {
  const rows = new Map<string, any>();
  let n = 0;
  return {
    rows,
    reset() { rows.clear(); n = 0; },
    task: {
      create: async ({ data }: any) => {
        const row = { id: "t" + ++n, auditLog: "[]", approvalNote: null, proposedAction: null, ...data };
        rows.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (!row || (where.status !== undefined && row.status !== where.status)) return { count: 0 };
        rows.set(where.id, { ...row, ...data });
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: any) => {
        if (!rows.has(where.id)) throw new Error("Task not found");
        return { ...rows.get(where.id) };
      },
    },
  };
});

vi.mock("../lib/prisma", () => ({ prisma: { task: db.task } }));
vi.mock("../lib/llm", () => ({ assessTask: vi.fn(), executeAction: vi.fn() }));

import { approveTask, CONFIDENCE_THRESHOLD, rejectTask, submitTask } from "../lib/agent";
import { assessTask, executeAction } from "../lib/llm";

const assess = vi.mocked(assessTask);
const execute = vi.mocked(executeAction);
const events = (task: { auditLog: string }) => JSON.parse(task.auditLog).map((e: any) => e.event);

beforeEach(() => {
  db.reset();
  assess.mockReset();
  execute.mockReset();
  execute.mockResolvedValue("done");
});

describe("submitTask", () => {
  it("auto-runs a confident assessment", async () => {
    assess.mockResolvedValue({ proposedAction: "Summarise it", reasoning: "r", confidence: 0.9 });
    const task = await submitTask("summarise this");
    expect(task.status).toBe("COMPLETED");
    expect(task.result).toBe("done");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(events(task)).toEqual(["task_submitted", "agent_assessed", "auto_approved", "execution_completed"]);
  });

  it("auto-runs exactly at the threshold", async () => {
    assess.mockResolvedValue({ proposedAction: "Do it", reasoning: "r", confidence: CONFIDENCE_THRESHOLD });
    expect((await submitTask("x")).status).toBe("COMPLETED");
  });

  it("pauses below the threshold and does not execute", async () => {
    assess.mockResolvedValue({ proposedAction: "Delete the account", reasoning: "r", confidence: 0.74 });
    const task = await submitTask("delete my account");
    expect(task.status).toBe("PENDING_APPROVAL");
    expect(execute).not.toHaveBeenCalled();
    expect(events(task)).toContain("paused_for_approval");
  });

  it("pauses when there is no concrete action, however confident the model claims to be", async () => {
    assess.mockResolvedValue({ proposedAction: "", reasoning: "r", confidence: 0.99 });
    const task = await submitTask("do something");
    expect(task.status).toBe("PENDING_APPROVAL");
    expect(execute).not.toHaveBeenCalled();
    const paused = JSON.parse(task.auditLog).find((e: any) => e.event === "paused_for_approval");
    expect(paused.detail).toMatch(/no concrete action/);
  });

  it("records an assessment failure as FAILED without executing", async () => {
    assess.mockRejectedValue(new Error("Groq error 500"));
    const task = await submitTask("x");
    expect(task.status).toBe("FAILED");
    expect(task.errorMessage).toBe("Groq error 500");
    expect(execute).not.toHaveBeenCalled();
    expect(events(task)).toContain("agent_error");
  });

  it("records an execution failure as FAILED", async () => {
    assess.mockResolvedValue({ proposedAction: "Do it", reasoning: "r", confidence: 0.95 });
    execute.mockRejectedValue(new Error("tool down"));
    const task = await submitTask("x");
    expect(task.status).toBe("FAILED");
    expect(task.errorMessage).toBe("tool down");
    expect(events(task)).toContain("execution_failed");
  });
});

describe("approveTask / rejectTask", () => {
  async function pending() {
    assess.mockResolvedValue({ proposedAction: "Email the landlord", reasoning: "r", confidence: 0.4 });
    return submitTask("email my landlord");
  }

  it("approval executes the action with the reviewer's note", async () => {
    const p = await pending();
    const task = await approveTask(p.id, "Keep it polite");
    expect(task.status).toBe("COMPLETED");
    expect(execute).toHaveBeenCalledWith("email my landlord", "Email the landlord", "Keep it polite");
    expect(events(task)).toContain("human_approved");
  });

  it("rejection never executes", async () => {
    const p = await pending();
    const task = await rejectTask(p.id, "Not now");
    expect(task.status).toBe("REJECTED");
    expect(task.approvalNote).toBe("Not now");
    expect(execute).not.toHaveBeenCalled();
  });

  it("only a task awaiting approval can be approved or rejected", async () => {
    assess.mockResolvedValue({ proposedAction: "Do it", reasoning: "r", confidence: 0.95 });
    const done = await submitTask("x"); // auto-completed
    await expect(approveTask(done.id)).rejects.toThrow(/not awaiting approval/);
    await expect(rejectTask(done.id)).rejects.toThrow(/not awaiting approval/);
  });

  it("an unknown id is an error", async () => {
    await expect(approveTask("missing")).rejects.toThrow(/not found/i);
  });
});

describe("concurrent decisions on the same task", () => {
  async function pending() {
    assess.mockResolvedValue({ proposedAction: "Send the invoice", reasoning: "r", confidence: 0.4 });
    return submitTask("send the invoice");
  }

  it("two simultaneous approvals run the action once", async () => {
    const p = await pending();
    const results = await Promise.allSettled([approveTask(p.id, "a"), approveTask(p.id, "b")]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(execute).toHaveBeenCalledTimes(1);
    const loser = results[1] as PromiseRejectedResult;
    expect(loser.reason.message).toMatch(/not awaiting approval/);
    expect(db.rows.get(p.id).status).toBe("COMPLETED");
  });

  it("an approval that lands first beats a simultaneous rejection", async () => {
    const p = await pending();
    const results = await Promise.allSettled([approveTask(p.id), rejectTask(p.id)]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(db.rows.get(p.id).status).toBe("COMPLETED"); // not overwritten by the rejection
  });

  it("a rejection that lands first beats a simultaneous approval, and nothing runs", async () => {
    const p = await pending();
    const results = await Promise.allSettled([rejectTask(p.id), approveTask(p.id)]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(execute).not.toHaveBeenCalled();
    expect(db.rows.get(p.id).status).toBe("REJECTED");
  });

  it("a rejection that arrives earlier stops a later approval from executing", async () => {
    const p = await pending();
    await rejectTask(p.id, "no");
    await expect(approveTask(p.id)).rejects.toThrow(/not awaiting approval/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("the audit log records exactly one human decision", async () => {
    const p = await pending();
    await Promise.allSettled([approveTask(p.id), approveTask(p.id), rejectTask(p.id)]);
    const log = JSON.parse(db.rows.get(p.id).auditLog) as { event: string }[];
    expect(log.filter((e) => e.event.startsWith("human_")).length).toBe(1);
  });
});

import { prisma } from "./prisma";
import { assessTask, executeAction } from "./llm";
import type { Task } from "@prisma/client";

// Below this confidence, the agent MUST pause and wait for a human.
// This is the one line that turns "autonomous agent" into "safe agent."
export const CONFIDENCE_THRESHOLD = 0.75;

type AuditEntry = { ts: string; event: string; detail?: string };

function appendAudit(existing: string, event: string, detail?: string): string {
  let log: AuditEntry[] = [];
  try {
    log = JSON.parse(existing);
  } catch {
    log = [];
  }
  log.push({ ts: new Date().toISOString(), event, detail });
  return JSON.stringify(log);
}

/**
 * Entry point: create a task and run the agent's assessment step.
 * This is intentionally split from execution — the agent NEVER acts
 * on a low-confidence decision inside this function.
 */
export async function submitTask(input: string): Promise<Task> {
  let task = await prisma.task.create({
    data: {
      input,
      status: "PENDING_AGENT",
      auditLog: appendAudit("[]", "task_submitted", input),
    },
  });

  try {
    const assessment = await assessTask(input);

    task = await prisma.task.update({
      where: { id: task.id },
      data: {
        proposedAction: assessment.proposedAction,
        reasoning: assessment.reasoning,
        confidence: assessment.confidence,
        auditLog: appendAudit(
          task.auditLog,
          "agent_assessed",
          `confidence=${assessment.confidence.toFixed(2)} action="${assessment.proposedAction}"`
        ),
      },
    });

    if (assessment.confidence >= CONFIDENCE_THRESHOLD) {
      // High confidence: auto-execute, no human needed.
      task = await prisma.task.update({
        where: { id: task.id },
        data: {
          auditLog: appendAudit(
            task.auditLog,
            "auto_approved",
            `confidence ${assessment.confidence.toFixed(2)} >= threshold ${CONFIDENCE_THRESHOLD}`
          ),
        },
      });
      return await runExecution(task.id);
    }

    // Low confidence: STOP. Do not execute. Wait for a human.
    task = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "PENDING_APPROVAL",
        auditLog: appendAudit(
          task.auditLog,
          "paused_for_approval",
          `confidence ${assessment.confidence.toFixed(2)} < threshold ${CONFIDENCE_THRESHOLD}`
        ),
      },
    });
    return task;
  } catch (err: any) {
    return prisma.task.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        errorMessage: err.message,
        auditLog: appendAudit(task.auditLog, "agent_error", err.message),
      },
    });
  }
}

/**
 * Called when a human clicks Approve on a PENDING_APPROVAL task.
 * This is a fresh, stateless function call (as it must be on serverless) —
 * all the context it needs was persisted to the DB, not held in memory.
 */
export async function approveTask(id: string, approvalNote?: string): Promise<Task> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id } });
  if (task.status !== "PENDING_APPROVAL") {
    throw new Error(`Task is in status ${task.status}, not awaiting approval`);
  }

  await prisma.task.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvalNote: approvalNote || null,
      auditLog: appendAudit(task.auditLog, "human_approved", approvalNote),
    },
  });

  return runExecution(id);
}

/**
 * Called when a human clicks Reject. The agent's proposed action is
 * discarded and never executed.
 */
export async function rejectTask(id: string, approvalNote?: string): Promise<Task> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id } });
  if (task.status !== "PENDING_APPROVAL") {
    throw new Error(`Task is in status ${task.status}, not awaiting approval`);
  }

  return prisma.task.update({
    where: { id },
    data: {
      status: "REJECTED",
      approvalNote: approvalNote || null,
      auditLog: appendAudit(task.auditLog, "human_rejected", approvalNote),
    },
  });
}

async function runExecution(id: string): Promise<Task> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id } });
  try {
    const result = await executeAction(
      task.input,
      task.proposedAction || "",
      task.approvalNote || undefined
    );
    return prisma.task.update({
      where: { id },
      data: {
        status: "COMPLETED",
        result,
        auditLog: appendAudit(task.auditLog, "execution_completed"),
      },
    });
  } catch (err: any) {
    return prisma.task.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: err.message,
        auditLog: appendAudit(task.auditLog, "execution_failed", err.message),
      },
    });
  }
}

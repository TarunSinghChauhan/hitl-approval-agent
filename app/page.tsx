"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Ban,
  Trash2,
  ChevronDown,
  Send,
} from "lucide-react";

type Status =
  | "PENDING_AGENT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "FAILED";

interface AuditEntry {
  ts: string;
  event: string;
  detail?: string;
}

interface Task {
  id: string;
  input: string;
  status: Status;
  proposedAction: string | null;
  reasoning: string | null;
  confidence: number | null;
  result: string | null;
  errorMessage: string | null;
  approvalNote: string | null;
  auditLog: string;
  createdAt: string;
  updatedAt: string;
}

type StatusMeta = { label: string; icon: React.ElementType; className: string };

const STATUS_META: Record<Status, StatusMeta> = {
  PENDING_AGENT: { label: "Agent thinking", icon: Loader2, className: "badge-thinking" },
  PENDING_APPROVAL: { label: "Awaiting approval", icon: ShieldAlert, className: "badge-pending" },
  APPROVED: { label: "Executing", icon: Loader2, className: "badge-executing" },
  REJECTED: { label: "Rejected", icon: Ban, className: "badge-rejected" },
  COMPLETED: { label: "Completed", icon: CheckCircle2, className: "badge-completed" },
  FAILED: { label: "Failed", icon: XCircle, className: "badge-failed" },
};

function confidenceColor(c: number) {
  if (c >= 0.75) return "#35c26b";
  if (c >= 0.5) return "#e8a13c";
  return "#e5484d";
}

const cardVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: -24, scale: 0.97, transition: { duration: 0.25, ease: "easeIn" } },
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expandedAudit, setExpandedAudit] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchTasks() {
    try {
      const res = await fetch("/api/agent/tasks");
      const data = await res.json();
      if (data.tasks) setTasks(data.tasks);
    } catch {
      // silent — polling, don't spam errors
    }
  }

  useEffect(() => {
    fetchTasks();
    pollRef.current = setInterval(fetchTasks, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSubmit() {
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/agent/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      setInput("");
      await fetchTasks();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecision(id: string, action: "approve" | "reject") {
    setActingOn(id);
    setError("");
    try {
      const res = await fetch(`/api/agent/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note: notes[id] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      await fetchTasks();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActingOn(null);
    }
  }

  function requestDelete(id: string) {
    if (confirmDelete === id) return;
    setConfirmDelete(id);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmDelete(null), 4000);
  }

  async function handleDelete(id: string) {
    setActingOn(id);
    setError("");
    setConfirmDelete(null);
    try {
      const res = await fetch("/api/agent/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActingOn(null);
    }
  }

  function parseAudit(log: string): AuditEntry[] {
    try {
      return JSON.parse(log);
    } catch {
      return [];
    }
  }

  return (
    <div className="wrap">
      <motion.div
        className="header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <h1>
          <Sparkles size={22} className="header-icon" />
          Human-in-the-Loop Approval Agent
        </h1>
        <p>
          The agent handles what it&apos;s confident about on its own, and pauses to ask
          before anything uncertain, irreversible, or sensitive.
        </p>
        <span className="threshold-note">
          <ShieldCheck size={13} /> Auto-execute threshold: confidence ≥ 0.75
        </span>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            className="error-banner"
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.25 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="submit-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
      >
        <textarea
          placeholder="Give the agent a task, e.g. 'Draft a refund policy summary for our support page' or 'Delete all inactive user accounts older than 2 years'…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          }}
        />
        <div className="row">
          <motion.button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !input.trim()}
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: submitting ? 1 : 1.02 }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spin" /> Submitting…
              </>
            ) : (
              <>
                <Send size={14} /> Submit task
              </>
            )}
          </motion.button>
        </div>
      </motion.div>

      {tasks.length === 0 && (
        <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          No tasks yet. Submit one above.
        </motion.div>
      )}

      <motion.div layout className="task-list">
        <AnimatePresence mode="popLayout">
          {tasks.map((t) => {
            const audit = parseAudit(t.auditLog);
            const isExpanded = !!expandedAudit[t.id];
            const meta = STATUS_META[t.status];
            const StatusIcon = meta.icon;
            const isSpinning = t.status === "PENDING_AGENT" || t.status === "APPROVED";
            const isConfirming = confirmDelete === t.id;
            const isBusy = actingOn === t.id;

            return (
              <motion.div
                className="task"
                key={t.id}
                layout
                variants={cardVariants}
                initial="hidden"
                animate="show"
                exit="exit"
              >
                <div className="task-top">
                  <div>
                    <p className="task-input">{t.input}</p>
                    <span className="task-time">
                      {new Date(t.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="task-top-right">
                    <motion.span
                      className={`badge ${meta.className}`}
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      key={t.status}
                      transition={{ type: "spring", stiffness: 400, damping: 20 }}
                    >
                      <StatusIcon size={12} className={isSpinning ? "spin" : ""} />
                      {meta.label}
                    </motion.span>
                    <motion.button
                      className={`icon-btn ${isConfirming ? "icon-btn-danger-armed" : ""}`}
                      onClick={() =>
                        isConfirming ? handleDelete(t.id) : requestDelete(t.id)
                      }
                      disabled={isBusy}
                      whileTap={{ scale: 0.9 }}
                      title={isConfirming ? "Click again to confirm delete" : "Delete task"}
                    >
                      {isBusy ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </motion.button>
                  </div>
                </div>

                <AnimatePresence>
                  {isConfirming && (
                    <motion.div
                      className="confirm-strip"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      Click the trash icon again to permanently delete this record — this is
                      exactly the kind of irreversible action this app is built to double-check.
                    </motion.div>
                  )}
                </AnimatePresence>

                {(t.proposedAction || t.confidence !== null) && (
                  <div className="detail">
                    {t.confidence !== null && (
                      <div className="detail-row">
                        <span className="detail-label">Confidence</span>
                        <div className="confidence-bar-wrap">
                          <motion.div
                            className="confidence-bar"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.round(t.confidence * 100)}%` }}
                            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                            style={{ background: confidenceColor(t.confidence) }}
                          />
                        </div>
                        <span style={{ color: confidenceColor(t.confidence), fontWeight: 600 }}>
                          {Math.round(t.confidence * 100)}%
                        </span>
                      </div>
                    )}
                    {t.proposedAction && (
                      <div className="detail-row">
                        <span className="detail-label">Proposes</span>
                        <span>{t.proposedAction}</span>
                      </div>
                    )}
                    {t.reasoning && (
                      <div className="detail-row">
                        <span className="detail-label">Reasoning</span>
                        <span style={{ color: "#8b92a0" }}>{t.reasoning}</span>
                      </div>
                    )}
                    {t.result && (
                      <div className="detail-row">
                        <span className="detail-label">Result</span>
                        <span>{t.result}</span>
                      </div>
                    )}
                    {t.errorMessage && (
                      <div className="detail-row">
                        <span className="detail-label">Error</span>
                        <span style={{ color: "#e5484d" }}>{t.errorMessage}</span>
                      </div>
                    )}
                    {t.approvalNote && (
                      <div className="detail-row">
                        <span className="detail-label">Your note</span>
                        <span>{t.approvalNote}</span>
                      </div>
                    )}
                  </div>
                )}

                <AnimatePresence>
                  {t.status === "PENDING_APPROVAL" && (
                    <motion.div
                      className="approval-box"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      <input
                        placeholder="Optional note to attach to your decision…"
                        value={notes[t.id] || ""}
                        onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })}
                      />
                      <div className="row" style={{ justifyContent: "flex-start" }}>
                        <motion.button
                          className="btn-approve"
                          disabled={isBusy}
                          onClick={() => handleDecision(t.id, "approve")}
                          whileTap={{ scale: 0.96 }}
                          whileHover={{ scale: 1.02 }}
                        >
                          {isBusy ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <CheckCircle2 size={14} />
                          )}
                          Approve & execute
                        </motion.button>
                        <motion.button
                          className="btn-reject"
                          disabled={isBusy}
                          onClick={() => handleDecision(t.id, "reject")}
                          whileTap={{ scale: 0.96 }}
                          whileHover={{ scale: 1.02 }}
                        >
                          <XCircle size={14} />
                          Reject
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  className="audit-toggle"
                  onClick={() => setExpandedAudit({ ...expandedAudit, [t.id]: !isExpanded })}
                >
                  <motion.span
                    animate={{ rotate: isExpanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ display: "inline-flex" }}
                  >
                    <ChevronDown size={13} />
                  </motion.span>
                  {isExpanded ? "Hide audit trail" : `View audit trail (${audit.length})`}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      className="audit-log"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                    >
                      {audit.map((a, i) => (
                        <motion.div
                          className="audit-entry"
                          key={i}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: i * 0.04 }}
                        >
                          <span style={{ flexShrink: 0 }}>
                            {new Date(a.ts).toLocaleTimeString()}
                          </span>
                          <span style={{ color: "#e6e8eb" }}>{a.event}</span>
                          {a.detail && <span>— {a.detail}</span>}
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
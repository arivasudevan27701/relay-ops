import { useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { getToolApproval, useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import { DESK_ID, REGION_LABEL, type JobRow, type Region, type RelayState, type ResourceRow } from "./types";
import {
  type ChatSession,
  createSession,
  loadSessions,
  persistSessions,
  startNewChat,
  titleFrom
} from "./sessions";

type MessagePart = UIMessage["parts"][number];

type DeskPayload = {
  deskId: string;
  resources: ResourceRow[];
  jobs: JobRow[];
};

const EXAMPLES = [
  "Spin up a staging Redis for payments, 1GB, London",
  "What's on the fleet?",
  "Restart the last one",
  "Tear down payments-cache"
];

function statusColor(status: string): string {
  if (status === "running" || status === "complete" || status === "healthy") return "var(--live)";
  if (status === "errored" || status === "failed" || status === "gone") return "var(--bad)";
  return "var(--warn)";
}

export function App() {
  const [{ sessions, activeId }, setChat] = useState(() => loadSessions());
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [seed, setSeed] = useState({ text: "", n: 0 });

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch(`/api/desk?desk=${DESK_ID}`);
        if (!res.ok || cancelled) return;
        setDesk(await res.json());
      } catch {
        /* local wrangler may not have D1 ready on first tick */
      }
    };
    pull();
    const id = setInterval(pull, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const commit = (next: ChatSession[], nextActive: string) => {
    persistSessions(next, nextActive);
    setChat({ sessions: next, activeId: nextActive });
  };

  const onNewChat = () => {
    const next = startNewChat(sessions);
    commit(next.sessions, next.activeId);
  };

  const onOpenChat = (id: string) => commit(sessions, id);

  const onDeleteChat = (id: string) => {
    const remaining = sessions.filter((row) => row.id !== id);
    if (!remaining.length) {
      const created = createSession([]);
      commit([created], created.id);
      return;
    }
    commit(remaining, id === activeId ? remaining[0].id : activeId);
  };

  const onActivity = (text: string) => {
    const title = titleFrom(text);
    commit(
      sessions
        .map((row) =>
          row.id === activeId
            ? { ...row, title: row.title || title, updatedAt: Date.now() }
            : row
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
      activeId
    );
  };

  const compose = (text: string) => setSeed((current) => ({ text, n: current.n + 1 }));
  const latestJob = desk?.jobs[0] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] tracking-[0.28em] text-[var(--accent)]">RELAY</span>
          <h1 className="text-sm font-medium">infra control plane</h1>
        </div>
        <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
          <span>
            desk <code className="text-[var(--text)]">{DESK_ID}</code>
          </span>
          <button
            type="button"
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[var(--text)] hover:border-[var(--accent)]"
            onClick={onNewChat}
          >
            New chat
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
        <aside className="min-h-0 overflow-y-auto border-r border-[var(--line)] p-4">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel>chats</SectionLabel>
            <button
              type="button"
              className="text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
              onClick={onNewChat}
            >
              + new
            </button>
          </div>
          <ul className="space-y-1">
            {sessions.map((row) => {
              const active = row.id === activeId;
              return (
                <li key={row.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-md ${
                      active ? "bg-[var(--panel)] ring-1 ring-[var(--line)]" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={`min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs ${
                        active ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                      }`}
                      onClick={() => onOpenChat(row.id)}
                    >
                      {row.title || "New chat"}
                    </button>
                    <button
                      type="button"
                      className="hidden px-2 text-[10px] text-[var(--muted)] hover:text-[var(--bad)] group-hover:block"
                      onClick={() => onDeleteChat(row.id)}
                      aria-label="delete chat"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <SectionLabel className="mt-6">fleet</SectionLabel>
          {!desk?.resources.length ? (
            <p className="mt-3 text-xs text-[var(--muted)]">Empty. Provision something.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {desk.resources.map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">{row.name}</span>
                    <StatusDot status={row.status} />
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                    {row.kind} · {REGION_LABEL[row.region]} · {row.size}
                  </p>
                  <div className="mt-2 flex gap-2 text-[10px] text-[var(--muted)]">
                    <button type="button" className="hover:text-[var(--text)]" onClick={() => compose(`Restart ${row.name}`)}>
                      restart
                    </button>
                    <button type="button" className="hover:text-[var(--text)]" onClick={() => compose(`Status of ${row.name}`)}>
                      status
                    </button>
                    <button type="button" className="hover:text-[var(--bad)]" onClick={() => compose(`Tear down ${row.name}`)}>
                      teardown
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <ChatThread key={activeId} sessionId={activeId} seed={seed} onActivity={onActivity} />

        <aside className="min-h-0 overflow-y-auto border-l border-[var(--line)] p-4">
          <SectionLabel>last job</SectionLabel>
          {latestJob ? <JobCard job={latestJob} /> : (
            <p className="mt-3 text-xs text-[var(--muted)]">No jobs yet.</p>
          )}

          <SectionLabel className="mt-6">recent</SectionLabel>
          <ul className="mt-3 space-y-2">
            {(desk?.jobs ?? []).slice(0, 8).map((job) => (
              <li key={job.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-[var(--muted)]">
                  {job.action} {job.resource_name}
                </span>
                <StatusDot status={job.status} />
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function ChatThread({
  sessionId,
  seed,
  onActivity
}: {
  sessionId: string;
  seed: { text: string; n: number };
  onActivity: (text: string) => void;
}) {
  const [relayState, setRelayState] = useState<RelayState | null>(null);
  const agent = useAgent<RelayState>({
    agent: "RelayAgent",
    name: sessionId,
    onStateUpdate: (state) => setRelayState(state)
  });
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, addToolApprovalResponse, status } = useAgentChat({
    agent,
    id: sessionId
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!seed.text) return;
    setDraft(seed.text);
    input.current?.focus();
  }, [seed]);

  const busy = status === "streaming" || status === "submitted";

  const onSend = (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    onActivity(value);
    sendMessage({ text: value });
    setDraft("");
  };

  return (
    <main className="flex min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex w-full max-w-2xl flex-col space-y-4">
          {messages.length === 0 && (
            <div className="pt-10">
              <p className="text-sm text-[var(--muted)]">
                New session. Llama 3.3 greets; a local parser and a Cloudflare Workflow do the
                rest. The fleet is shared across chats on this desk.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-left text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--text)]"
                    onClick={() => onSend(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const mine = msg.role === "user";
            const visible = msg.parts.filter(isVisiblePart);
            if (!visible.length) return null;
            return (
              <article
                key={msg.id}
                className={`flex max-w-[85%] flex-col ${mine ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                <div className="mb-1 text-[10px] tracking-[0.18em] text-[var(--muted)] uppercase">
                  {mine ? "operator" : "relay"}
                </div>
                <div
                  className={`space-y-2 rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                    mine
                      ? "rounded-br-md bg-[var(--accent)]/15 text-[var(--text)]"
                      : "rounded-bl-md border border-[var(--line)] bg-[var(--panel)]"
                  }`}
                >
                  {visible.map((part, i) => (
                    <PartView
                      key={`${msg.id}-${i}`}
                      part={part}
                      onApprove={(id, approved) => addToolApprovalResponse({ id, approved })}
                    />
                  ))}
                </div>
              </article>
            );
          })}
          {busy && (
            <article className="mr-auto flex max-w-[85%] flex-col items-start">
              <div className="mb-1 text-[10px] tracking-[0.18em] text-[var(--muted)] uppercase">
                relay
              </div>
              <div className="rounded-2xl rounded-bl-md border border-[var(--line)] bg-[var(--panel)] px-3.5 py-2.5 text-sm text-[var(--muted)]">
                working…
              </div>
            </article>
          )}
        </div>
      </div>

      <form
        className="border-t border-[var(--line)] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(draft);
        }}
      >
        {relayState?.pendingTeardown && (
          <div className="mx-auto mb-3 max-w-2xl rounded-md border border-[var(--bad)]/40 bg-[var(--panel)] p-3">
            <p className="text-xs text-[var(--muted)]">
              Approve teardown of{" "}
              <span className="text-[var(--text)]">{relayState.pendingTeardown}</span>?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded bg-[var(--bad)] px-3 py-1 text-xs text-black"
                onClick={() => onSend("approve teardown")}
              >
                approve teardown
              </button>
              <button
                type="button"
                className="rounded border border-[var(--line)] px-3 py-1 text-xs"
                onClick={() => onSend("reject teardown")}
              >
                reject
              </button>
            </div>
          </div>
        )}
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <span className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: busy ? "var(--warn)" : "var(--live)" }}
            />
            {busy ? "dispatching" : "idle"}
          </span>
          <input
            ref={input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="provision, restart, status, teardown…"
            className="flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            send
          </button>
        </div>
      </form>
    </main>
  );
}

function SectionLabel({
  children,
  className = ""
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`text-[10px] tracking-[0.22em] text-[var(--muted)] uppercase ${className}`}>
      {children}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: statusColor(status) }}
      />
      {status}
    </span>
  );
}

function JobCard({ job }: { job: JobRow }) {
  const stages = STAGES[job.action] ?? ["accepted"];
  const current = currentStage(job);
  const facts = jobFacts(job);
  const running = job.status === "running";

  return (
    <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm">{job.action}</span>
        <StatusDot status={job.status} />
      </div>
      <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">{job.resource_name}</p>
      {running && (
        <ol className="mt-3 space-y-1">
          {stages.map((stage) => {
            const reached = stages.indexOf(stage) <= stages.indexOf(current);
            const active = stage === current;
            return (
              <li
                key={stage}
                className={`text-[11px] ${active ? "text-[var(--text)]" : reached ? "text-[var(--muted)]" : "text-[var(--line)]"}`}
              >
                {active ? "●" : reached ? "○" : "·"} {stage}
              </li>
            );
          })}
        </ol>
      )}
      {facts.length > 0 && (
        <ul className="mt-3 space-y-1">
          {facts.map((line) => (
            <li key={line} className="break-all font-mono text-[10px] text-[var(--muted)]">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STAGES: Record<string, string[]> = {
  provision: ["accepted", "validating", "allocating", "configuring", "healthcheck"],
  restart: ["accepted", "draining", "healthcheck"],
  teardown: ["accepted", "draining", "destroy"],
  status: ["accepted", "probe"]
};

function currentStage(job: JobRow): string {
  const detail = job.detail ?? "accepted";
  if (detail.startsWith("{") || detail.startsWith("[")) return STAGES[job.action]?.at(-1) ?? "accepted";
  return STAGES[job.action]?.includes(detail) ? detail : "accepted";
}

function jobFacts(job: JobRow): string[] {
  const detail = job.detail;
  if (!detail) return [];
  if (job.status === "errored") return [detail.startsWith("{") ? "workflow failed" : detail];
  if (!detail.startsWith("{") && !detail.startsWith("[")) return [];
  try {
    const data = JSON.parse(detail) as {
      message?: string;
      idempotent?: boolean;
      destroyed?: string;
      probe?: string;
      resource?: { endpoint?: string; region?: string };
    };
    const facts: string[] = [];
    if (data.idempotent) facts.push("already on the fleet");
    if (data.message) facts.push(data.message);
    if (data.destroyed) facts.push(`destroyed ${data.destroyed}`);
    if (data.probe) facts.push(`probe ${data.probe}`);
    if (data.resource?.endpoint) facts.push(data.resource.endpoint);
    if (data.resource?.region) {
      facts.push(REGION_LABEL[data.resource.region as Region] ?? data.resource.region);
    }
    return facts;
  } catch {
    return [];
  }
}

function isLeakedToolJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && /"name"\s*:/.test(trimmed) && /parameters/.test(trimmed)) ||
    trimmed.startsWith('{"name": "dispatchJob"') ||
    trimmed.startsWith('{"name": "listFleet"')
  );
}

function isVisiblePart(part: MessagePart): boolean {
  if (part.type === "text" && part.text?.trim() && !isLeakedToolJson(part.text)) return true;
  return (part as MessagePart & { state?: string }).state === "approval-requested";
}

function PartView({
  part,
  onApprove
}: {
  part: MessagePart;
  onApprove: (id: string, approved: boolean) => void;
}) {
  if (part.type === "text" && part.text && !isLeakedToolJson(part.text)) {
    return <p className="whitespace-pre-wrap">{part.text}</p>;
  }

  const toolPart = part as MessagePart & {
    state?: string;
    toolName?: string;
    input?: unknown;
    output?: unknown;
  };

  if (toolPart.state === "approval-requested") {
    const approval = getToolApproval(part);
    if (!approval) return null;
    return (
      <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--panel)] p-3">
        <p className="text-xs text-[var(--muted)]">
          Approve <span className="text-[var(--text)]">{toolPart.toolName}</span>?
        </p>
        <pre className="mt-2 overflow-auto font-mono text-[11px] text-[var(--muted)]">
          {JSON.stringify(toolPart.input, null, 2)}
        </pre>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded bg-[var(--bad)] px-3 py-1 text-xs text-black"
            onClick={() => onApprove(approval.id, true)}
          >
            approve teardown
          </button>
          <button
            type="button"
            className="rounded border border-[var(--line)] px-3 py-1 text-xs"
            onClick={() => onApprove(approval.id, false)}
          >
            reject
          </button>
        </div>
      </div>
    );
  }

  if (toolPart.state === "output-available" || toolPart.toolName || part.type.startsWith("tool-")) {
    return null;
  }

  return null;
}

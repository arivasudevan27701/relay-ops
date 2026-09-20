import { useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { getToolApproval, useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import { DESK_ID, REGION_LABEL, type JobRow, type ResourceRow } from "./types";

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
  const agent = useAgent({ agent: "RelayAgent", name: DESK_ID });
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, clearHistory, addToolApprovalResponse, status } =
    useAgentChat({ agent });

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

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const latestJob = desk?.jobs[0] ?? null;
  const busy = status === "streaming" || status === "submitted";

  const onSend = (text: string) => {
    const value = text.trim();
    if (!value || busy) return;
    sendMessage({ text: value });
    setDraft("");
  };

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
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: busy ? "var(--warn)" : "var(--live)" }}
            />
            {busy ? "dispatching" : "idle"}
          </span>
          <button
            type="button"
            className="text-[var(--muted)] hover:text-[var(--text)]"
            onClick={() => clearHistory()}
          >
            clear chat
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
        <aside className="min-h-0 overflow-y-auto border-r border-[var(--line)] p-4">
          <SectionLabel>fleet</SectionLabel>
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
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="flex min-h-0 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {messages.length === 0 && (
              <div className="mx-auto max-w-xl pt-10">
                <p className="text-sm text-[var(--muted)]">
                  Tell Relay what to run. It extracts intent with Llama 3.3, then a Cloudflare
                  Workflow does the work. Memory lives in this desk.
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

            {messages.map((msg) => (
              <article key={msg.id} className="mx-auto max-w-2xl">
                <div className="mb-1 text-[10px] tracking-[0.18em] text-[var(--muted)] uppercase">
                  {msg.role === "user" ? "operator" : "relay"}
                </div>
                <div className="space-y-2 text-sm leading-6">
                  {msg.parts.map((part, i) => (
                    <PartView
                      key={`${msg.id}-${i}`}
                      part={part}
                      onApprove={(id, approved) =>
                        addToolApprovalResponse({ id, approved })
                      }
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>

          <form
            className="border-t border-[var(--line)] p-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSend(draft);
            }}
          >
            <div className="mx-auto flex max-w-2xl gap-2">
              <input
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

        <aside className="min-h-0 overflow-y-auto border-l border-[var(--line)] p-4">
          <SectionLabel>last job</SectionLabel>
          {latestJob ? (
            <div className="mt-3 rounded-md border border-[var(--line)] bg-[var(--panel)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">{latestJob.action}</span>
                <StatusDot status={latestJob.status} />
              </div>
              <p className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                {latestJob.resource_name}
              </p>
              <p className="mt-2 break-all font-mono text-[10px] text-[var(--muted)]">
                {latestJob.id}
              </p>
              {latestJob.detail && (
                <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--muted)]">
                  {pretty(latestJob.detail)}
                </pre>
              )}
            </div>
          ) : (
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

function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function PartView({
  part,
  onApprove
}: {
  part: MessagePart;
  onApprove: (id: string, approved: boolean) => void;
}) {
  if (part.type === "text" && part.text) {
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
    const label = toolPart.toolName ?? part.type;
    return (
      <details className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2">
        <summary className="cursor-pointer font-mono text-[11px] text-[var(--muted)]">
          {label}
          {toolPart.state ? ` · ${toolPart.state}` : ""}
        </summary>
        <pre className="mt-2 overflow-auto font-mono text-[11px] text-[var(--muted)]">
          {JSON.stringify(toolPart.output ?? toolPart.input ?? part, null, 2)}
        </pre>
      </details>
    );
  }

  return null;
}

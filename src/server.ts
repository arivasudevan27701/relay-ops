import { AIChatAgent } from "@cloudflare/ai-chat";
import { Agent, routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import { createUIMessageStream, createUIMessageStreamResponse, generateText } from "ai";
import { extractIntent, MODEL } from "./extract";
import { parseOps, type ParsedIntent } from "./intent";
import { ensureSchema, getByName, listJobs, listResources } from "./inventory";
import { InfraWorkflow } from "./workflow";
import {
  DESK_ID,
  REGION_LABEL,
  type JobParams,
  type RelayState,
  type ResourceRow
} from "./types";

export { InfraWorkflow };

type SpanAttrs = Record<string, unknown>;
type AgentWithSpan = {
  _withAgentSpan(
    operation: string,
    storagePhase: string,
    attributes: SpanAttrs,
    run: (update: (attrs: SpanAttrs) => void) => unknown
  ): unknown;
};

const agentProto = Agent.prototype as unknown as AgentWithSpan;
if (typeof agentProto._withAgentSpan !== "function") {
  agentProto._withAgentSpan = (_operation, _storagePhase, _attributes, run) => run(() => {});
}

const CHAT_SYSTEM = `You are Relay, a terse infra ops desk.
One short sentence. No JSON, no tool names, no key=value dumps.
If they greet you, say you can provision, restart, or tear down fleet resources.`;

function lastUserText(messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    return msg.parts
      .map((part) => (part.type === "text" && part.text ? part.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function say(text: string) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute({ writer }) {
        const id = crypto.randomUUID();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
      }
    })
  });
}

function where(region: string | undefined): string {
  if (!region) return "";
  return REGION_LABEL[region as keyof typeof REGION_LABEL] ?? region;
}

function phraseOps(
  intent: ParsedIntent,
  facts: {
    error?: string;
    count?: number;
    resources?: ResourceRow[];
    needsApproval?: boolean;
    cancelled?: boolean;
    name?: string;
    kind?: string;
    region?: string;
    ok?: boolean;
    jobId?: string;
    dispatched?: JobParams;
    jobs?: Array<{ action: string; resource_name: string; status: string }>;
    state?: RelayState;
  }
): string {
  if (facts.error) return facts.error;
  if (intent.type === "list") {
    const rows = facts.resources ?? [];
    if (!rows.length) return "Fleet is empty.";
    return rows
      .map((row) => `${row.name} · ${row.kind} · ${where(row.region)} · ${row.status}`)
      .join("\n");
  }
  if (facts.needsApproval && facts.name) {
    return `Teardown of ${facts.name} is destructive. Approve it below.`;
  }
  if (facts.cancelled && facts.name) return `Left ${facts.name} running.`;
  if (intent.type === "recall") {
    const last = facts.state?.lastResourceName;
    const jobs = facts.jobs ?? [];
    if (!last && !jobs.length) return "No jobs on this desk yet.";
    const recent = jobs[0];
    return last
      ? `Last resource is ${last}${recent ? `; last job ${recent.action} is ${recent.status}` : ""}.`
      : `Last job ${recent.action} on ${recent.resource_name} is ${recent.status}.`;
  }
  if (facts.ok && facts.jobId && facts.dispatched) {
    const job = facts.dispatched;
    const place = where(job.region);
    const loc = place ? ` in ${place}` : "";
    if (job.action === "provision") {
      return `Provisioning ${job.name}${loc}. Job ${facts.jobId} is running.`;
    }
    if (job.action === "restart") {
      return `Restarting ${job.name}${loc}. Job ${facts.jobId} is running.`;
    }
    if (job.action === "teardown") {
      return `Tearing down ${job.name}${loc}. Job ${facts.jobId} is running.`;
    }
    return `Checking ${job.name}${loc}. Job ${facts.jobId} is running.`;
  }
  return "Nothing to report.";
}

export class RelayAgent extends AIChatAgent<Env, RelayState> {
  initialState: RelayState = {
    lastJobId: null,
    lastAction: null,
    lastResourceName: null,
    pendingTeardown: null
  };

  async onChatMessage(_onFinish: unknown, options?: { abortSignal?: AbortSignal }) {
    const deskId = DESK_ID;
    const userText = lastUserText(this.messages);

    await ensureSchema(this.env.DB);
    const resources = await listResources(this.env.DB, deskId);
    const jobs = await listJobs(this.env.DB, deskId);
    const lastName =
      this.state.lastResourceName ?? resources[0]?.name ?? jobs[0]?.resource_name ?? null;
    const hydrated: RelayState = { ...this.state, lastResourceName: lastName };

    let intent = parseOps(userText, hydrated);
    const localGate =
      Boolean(this.state.pendingTeardown) &&
      (intent.type === "cancel-teardown" ||
        (intent.type === "job" &&
          intent.action === "teardown" &&
          /\b(approve|confirm|yes)\b/i.test(userText)));

    if (!localGate) {
      const extracted = await extractIntent(
        this.env,
        userText,
        hydrated,
        resources.map((row) => row.name),
        options
      );
      intent = extracted ?? parseOps(userText, hydrated);
    }

    if (intent.type === "chat") {
      const workersai = createWorkersAI({ binding: this.env.AI });
      const { text } = await generateText({
        model: workersai(MODEL),
        system: CHAT_SYSTEM,
        prompt: userText || "hello",
        abortSignal: options?.abortSignal
      });
      return say(text.trim() || "Relay. Provision, restart, or tear down from this desk.");
    }

    let facts: Parameters<typeof phraseOps>[1] = {};
    try {
      if (intent.type === "list") {
        facts = { count: resources.length, resources };
      } else if (intent.type === "recall") {
        facts = {
          state: { ...this.state, lastResourceName: lastName },
          jobs
        };
      } else if (intent.type === "cancel-teardown") {
        const name = this.state.pendingTeardown;
        this.patchState({ pendingTeardown: null });
        facts = { cancelled: true, name: name ?? "resource" };
      } else if (intent.type === "job" && intent.action === "teardown") {
        const approved =
          Boolean(this.state.pendingTeardown) &&
          this.state.pendingTeardown === intent.name &&
          /\b(approve|confirm|yes)\b/i.test(userText);
        if (!approved) {
          const found = await getByName(this.env.DB, deskId, intent.name);
          if (!found) {
            facts = { error: `no live resource named ${intent.name} on desk ${deskId}` };
          } else {
            this.patchState({ pendingTeardown: intent.name });
            facts = {
              needsApproval: true,
              name: found.name,
              kind: found.kind,
              region: found.region
            };
          }
        } else {
          facts = await this.dispatch({
            action: intent.action,
            kind: intent.kind,
            name: intent.name,
            team: intent.team,
            region: intent.region,
            size: intent.size,
            deskId
          });
        }
      } else if (intent.type === "job") {
        facts = await this.dispatch({
          action: intent.action,
          kind: intent.kind,
          name: intent.name,
          team: intent.team,
          region: intent.region,
          size: intent.size,
          deskId
        });
      }
    } catch (error) {
      facts = { error: error instanceof Error ? error.message : String(error) };
    }

    return say(phraseOps(intent, facts));
  }

  private patchState(patch: Partial<RelayState>) {
    this.setState({ ...this.state, ...patch });
  }

  private async dispatch(params: JobParams) {
    const live =
      params.action === "provision" ? null : await getByName(this.env.DB, params.deskId, params.name);
    if (params.action !== "provision" && !live && params.action !== "status") {
      return { error: `no live resource named ${params.name} on desk ${params.deskId}` };
    }

    const hydrated: JobParams = live
      ? {
          ...params,
          kind: live.kind,
          team: live.team,
          region: live.region,
          size: live.size
        }
      : params;

    const instance = await this.env.INFRA_WORKFLOW.create({ params: hydrated });
    this.patchState({
      lastJobId: instance.id,
      lastAction: hydrated.action,
      lastResourceName: hydrated.name,
      pendingTeardown: hydrated.action === "teardown" ? null : this.state.pendingTeardown
    });
    return {
      ok: true as const,
      jobId: instance.id,
      dispatched: hydrated
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/desk") {
      const deskId = url.searchParams.get("desk") || DESK_ID;
      await ensureSchema(env.DB);
      const [resources, jobs] = await Promise.all([
        listResources(env.DB, deskId),
        listJobs(env.DB, deskId)
      ]);
      return Response.json({ deskId, resources, jobs });
    }

    if (url.pathname.startsWith("/api/jobs/")) {
      const jobId = url.pathname.slice("/api/jobs/".length);
      if (!jobId) return new Response("missing job id", { status: 400 });
      try {
        const instance = await env.INFRA_WORKFLOW.get(jobId);
        return Response.json(await instance.status());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ error: message }, { status: 404 });
      }
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;

import { AIChatAgent } from "@cloudflare/ai-chat";
import { routeAgentRequest } from "agents";
import { createWorkersAI } from "workers-ai-provider";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import { ensureSchema, getByName, listJobs, listResources } from "./inventory";
import { InfraWorkflow } from "./workflow";
import {
  ACTIONS,
  DESK_ID,
  KINDS,
  REGIONS,
  SIZES,
  type Action,
  type JobParams,
  type Kind,
  type Region,
  type RelayState,
  type Size
} from "./types";

export { InfraWorkflow };

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM = `You are Relay, the chat control plane for internal infrastructure.

You do not provision machines yourself. You dispatch durable jobs (Cloudflare Workflows) and report their results.

Rules:
- Always use tools for fleet facts. Never invent endpoints, job ids, or inventory.
- Map casual language to tools: "spin up", "stand up", "give me" → provision. "bounce" / "recycle" → restart. "kill" / "delete" / "tear down" → teardown. "is it up" → status. "what do we have" → listFleet.
- Default team to "platform", region to "iad", size to "small" when the operator omits them.
- Map city names: London/UK → lhr, Virginia/US-East/Ashburn → iad, Singapore → sin, Sydney/Australia → syd.
- Map size: 1GB/small → small, 4GB/medium → medium, 16GB/large → large.
- Resource names should be dns-safe kebab-case. If the operator says "staging redis for payments", name it payments-cache unless they gave a name.
- After dispatchJob, tell them the job id and that the workflow is running validate → allocate → configure → healthcheck.
- If they say "the last one" / "that redis", call recallContext first.
- Be terse. This is an ops desk, not a chatbot. No filler.
- Teardown is destructive and requires operator approval in the UI.`;

export class RelayAgent extends AIChatAgent<Env, RelayState> {
  initialState: RelayState = {
    lastJobId: null,
    lastAction: null,
    lastResourceName: null
  };

  async onChatMessage(_onFinish: unknown, options?: { abortSignal?: AbortSignal }) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const deskId = this.name || DESK_ID;

    const result = streamText({
      model: workersai(MODEL),
      system: SYSTEM,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        listFleet: tool({
          description: "List live resources on this ops desk.",
          inputSchema: z.object({}),
          execute: async () => {
            await ensureSchema(this.env.DB);
            const resources = await listResources(this.env.DB, deskId);
            return { deskId, count: resources.length, resources };
          }
        }),

        recallContext: tool({
          description:
            "Recall the last dispatched job and resource for this desk, plus recent jobs.",
          inputSchema: z.object({}),
          execute: async () => {
            await ensureSchema(this.env.DB);
            const jobs = await listJobs(this.env.DB, deskId);
            return { state: this.state, jobs };
          }
        }),

        getJobStatus: tool({
          description: "Read a workflow instance by job id.",
          inputSchema: z.object({
            jobId: z.string().describe("Workflow instance id")
          }),
          execute: async ({ jobId }) => {
            const instance = await this.env.INFRA_WORKFLOW.get(jobId);
            return await instance.status();
          }
        }),

        dispatchJob: tool({
          description:
            "Dispatch a durable infra job: provision, restart, teardown, or status.",
          inputSchema: z.object({
            action: z.enum(ACTIONS),
            kind: z.enum(KINDS),
            name: z
              .string()
              .regex(/^[a-z0-9][a-z0-9-]*$/)
              .describe("dns-safe resource name"),
            team: z.string().default("platform"),
            region: z.enum(REGIONS).default("iad"),
            size: z.enum(SIZES).default("small")
          }),
          needsApproval: async ({ action }) => action === "teardown",
          execute: async ({ action, kind, name, team, region, size }) => {
            await ensureSchema(this.env.DB);

            if (action !== "provision") {
              const found = await getByName(this.env.DB, deskId, name);
              if (!found && action !== "status") {
                return {
                  ok: false,
                  error: `no live resource named ${name} on desk ${deskId}`
                };
              }
            }

            const params: JobParams = {
              action: action as Action,
              kind: kind as Kind,
              name,
              team: team || "platform",
              region: (region || "iad") as Region,
              size: (size || "small") as Size,
              deskId
            };

            const instance = await this.env.INFRA_WORKFLOW.create({ params });
            this.setState({
              lastJobId: instance.id,
              lastAction: params.action,
              lastResourceName: params.name
            });

            return {
              ok: true,
              jobId: instance.id,
              dispatched: params,
              note: "workflow running; poll getJobStatus or the job panel"
            };
          }
        })
      },
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
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

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;

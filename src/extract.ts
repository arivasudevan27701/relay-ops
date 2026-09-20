import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { type ParsedIntent } from "./intent";
import { ACTIONS, KINDS, REGIONS, SIZES, type RelayState } from "./types";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const EXTRACT_MS = 8000;

export const intentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat") }),
  z.object({ type: z.literal("list") }),
  z.object({ type: z.literal("recall") }),
  z.object({
    type: z.literal("job"),
    action: z.enum(ACTIONS),
    kind: z.enum(KINDS),
    name: z.string().min(1).max(48),
    region: z.enum(REGIONS),
    size: z.enum(SIZES)
  })
]);

export type LlamaIntent = z.infer<typeof intentSchema>;

const EXTRACT_SYSTEM = `You extract infra-ops intent for Relay.
Return ONLY one JSON object. No markdown, no prose, no tool names.
Types:
{"type":"chat"}
{"type":"list"}
{"type":"recall"}
{"type":"job","action":"provision|restart|teardown|status","kind":"redis|postgres|kv|worker|queue","name":"kebab-case","region":"iad|lhr|sin|syd","size":"small|medium|large"}
Rules:
- Greetings, thanks, or unrelated talk → chat
- Asking what is running / on the fleet → list
- Asking what the last job or last resource was, without an action → recall
- "last one" / "that redis" uses lastResourceName when given
- payments + redis → name payments-cache
- London/UK → lhr, Singapore → sin, Sydney → syd, else iad
- 1GB → small, 4GB → medium, 16GB → large
- Never invent a resource name that is not in the fleet unless action is provision`;

export function parseLlamaJson(text: string): ParsedIntent | null {
  const raw = stripJson(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = intentSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.type !== "job") return result.data;
  return {
    type: "job",
    action: result.data.action,
    kind: result.data.kind,
    name: result.data.name,
    team: "platform",
    region: result.data.region,
    size: result.data.size
  };
}

export async function extractIntent(
  env: Env,
  userText: string,
  state: RelayState,
  fleetNames: string[],
  options?: { abortSignal?: AbortSignal }
): Promise<ParsedIntent | null> {
  const timeout = AbortSignal.timeout(EXTRACT_MS);
  const abortSignal = options?.abortSignal
    ? AbortSignal.any([options.abortSignal, timeout])
    : timeout;

  try {
    const workersai = createWorkersAI({ binding: env.AI });
    const { text } = await generateText({
      model: workersai(MODEL),
      system: EXTRACT_SYSTEM,
      prompt: [
        `lastResourceName: ${state.lastResourceName ?? "none"}`,
        `fleet: ${fleetNames.length ? fleetNames.join(", ") : "empty"}`,
        `operator: ${userText}`
      ].join("\n"),
      abortSignal
    });
    return parseLlamaJson(text);
  } catch {
    return null;
  }
}

function stripJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

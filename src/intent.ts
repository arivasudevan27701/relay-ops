import {
  type Action,
  type Kind,
  type Region,
  type Size,
  type RelayState
} from "./types";

export type ParsedIntent =
  | { type: "chat" }
  | { type: "list" }
  | { type: "recall" }
  | { type: "cancel-teardown" }
  | {
      type: "job";
      action: Action;
      kind: Kind;
      name: string;
      team: string;
      region: Region;
      size: Size;
    };

const KIND_RE: Array<[RegExp, Kind]> = [
  [/\bredis\b/, "redis"],
  [/\bpostgres|\bpg\b/, "postgres"],
  [/\bkv\b|key[- ]value/, "kv"],
  [/\bqueue\b/, "queue"],
  [/\bworker\b/, "worker"]
];

export function parseOps(text: string, state: RelayState): ParsedIntent {
  const t = text.toLowerCase();

  if (state.pendingTeardown) {
    if (/\b(approve|confirm|yes)\b/.test(t)) {
      return {
        type: "job",
        action: "teardown",
        kind: "redis",
        name: state.pendingTeardown,
        team: "platform",
        region: "iad",
        size: "small"
      };
    }
    if (/\b(reject|cancel|nevermind|nope)\b/.test(t)) return { type: "cancel-teardown" };
  }

  if (/\b(fleet|inventory|what(?:'s| is) on|do we have|list (?:them|it|resources|fleet))\b/.test(t)) {
    if (!/\b(spin|provision|restart|tear|kill|delete)\b/.test(t)) return { type: "list" };
  }

  if (/\b(last (?:one|job|resource)|that redis|recall)\b/.test(t) && !/\b(restart|bounce|recycle|tear|kill|status|up\??)\b/.test(t)) {
    return { type: "recall" };
  }

  let action: Action | null = null;
  if (/\b(spin|stand\s*up|provision|give me|create|launch)\b/.test(t)) action = "provision";
  else if (/\b(restart|bounce|recycle)\b/.test(t)) action = "restart";
  else if (/\b(tear|kill|delete|destroy|remove)\b/.test(t)) action = "teardown";
  else if (/\b(status|is it up|health)\b/.test(t)) action = "status";

  if (!action) return { type: "chat" };

  const kind = inferKind(t) ?? (state.lastResourceName ? "redis" : "redis");
  const name = inferName(t, kind, action, state);
  if (!name && action !== "provision") {
    if (state.lastResourceName) {
      return {
        type: "job",
        action,
        kind,
        name: state.lastResourceName,
        team: "platform",
        region: inferRegion(t),
        size: inferSize(t)
      };
    }
    return { type: "recall" };
  }

  return {
    type: "job",
    action,
    kind,
    name: name || `${kind}-1`,
    team: "platform",
    region: inferRegion(t),
    size: inferSize(t)
  };
}

function inferKind(t: string): Kind {
  for (const [re, kind] of KIND_RE) if (re.test(t)) return kind;
  return "redis";
}

function inferRegion(t: string): Region {
  if (/\blondon|\buk\b|\blhr\b/.test(t)) return "lhr";
  if (/\bsingapore|\bsin\b/.test(t)) return "sin";
  if (/\bsydney|\baustralia|\bsyd\b/.test(t)) return "syd";
  if (/\bashburn|\bvirginia|\beast\b|\biad\b/.test(t)) return "iad";
  return "iad";
}

function inferSize(t: string): Size {
  if (/\b16\s*gb|\blarge\b/.test(t)) return "large";
  if (/\b4\s*gb|\bmedium\b/.test(t)) return "medium";
  return "small";
}

function inferName(t: string, kind: Kind, action: Action, state: RelayState): string | null {
  if (/\blast (?:one|job|resource)|that redis\b/.test(t) && state.lastResourceName) {
    return state.lastResourceName;
  }
  const explicit = t.match(/\b([a-z0-9][a-z0-9-]{1,40})\b/g) ?? [];
  const skip = new Set([
    "spin",
    "up",
    "a",
    "staging",
    "for",
    "the",
    "last",
    "one",
    "tear",
    "down",
    "restart",
    "whats",
    "what",
    "on",
    "fleet",
    "gb",
    "1gb",
    "4gb",
    "16gb",
    "small",
    "medium",
    "large",
    "london",
    "singapore",
    "sydney",
    "ashburn",
    "redis",
    "postgres",
    "worker",
    "queue",
    "give",
    "me",
    "kill",
    "delete"
  ]);
  const named = explicit.find((w) => !skip.has(w) && w.includes("-"));
  if (named) return named;
  if (/\bpayments\b/.test(t) && kind === "redis") return "payments-cache";
  if (action === "provision") return `${kind}-1`;
  return named ?? null;
}

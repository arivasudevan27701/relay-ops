# Relay

Chat control plane for internal infrastructure, built as the Cloudflare Software Engineer take-home.

An operator types what they want. Llama 3.3 on Workers AI extracts a structured job (JSON). A regex parser is the fallback if Llama times out or returns junk. Llama does not invent fleet facts — D1 is the source of truth, and replies are templates. A Cloudflare Workflow runs the job as durable steps. Each chat is its own Durable Object session; the fleet is shared by the desk.

This is a mock control plane, not a cloud provider. Provisioning writes rows and endpoints, not real machines. That is the point: treat ops as a software problem.

## Assignment map

| Required | Here |
| --- | --- |
| LLM | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI (intent JSON + greetings) |
| Workflow / coordination | `InfraWorkflow` — validate → allocate → configure → healthcheck |
| Chat | Pages UI + Agents SDK (`RelayAgent`), one session per chat |
| Memory / state | Durable Object chat + `RelayState`; D1 inventory |
| Prompt history | [`PROMPTS.md`](./PROMPTS.md) |

## 30-second demo

Public: [https://relay-ops.arivasudevan27701.workers.dev](https://relay-ops.arivasudevan27701.workers.dev)

```bash
pnpm install
pnpm types
pnpm test
pnpm dev
```

Open the printed localhost URL or the public URL, then:

1. `Spin up a staging Redis for payments, 1GB, London`
2. Wait for the job panel to go `complete` and `payments-cache` to show `running` on the fleet.
3. `What's on the fleet?`
4. `Restart the last one`
5. `Tear down payments-cache` — confirm in the approval banner.

Name a resource `broken-cache` to watch healthcheck retries fail. **New chat** starts a fresh session; the fleet stays on the desk.

## Why Workflows instead of one Worker

A single request cannot honestly represent provision → healthcheck → persist. If the isolate dies mid-way, you want to resume after `allocate`, not redo it. `step.do` checkpoints that. The chat agent only dispatches; it does not pretend to be the control plane.

## Layout

- `src/server.ts` — `RelayAgent` and HTTP (`/api/desk`, `/api/jobs/:id`)
- `src/extract.ts` — Llama JSON intent (Zod); regex fallback in `intent.ts`
- `src/intent.ts` — local ops parser and teardown approve/reject gate
- `src/workflow.ts` — durable infra job
- `src/inventory.ts` — D1 fleet + job log
- `src/app.tsx` — ops desk UI
- `src/sessions.ts` — chat session list

## Deploy

```bash
wrangler login
wrangler d1 create relay-ops   # already created; id is in wrangler.jsonc
pnpm deploy
```

Llama 3.3 (Workers AI) needs `wrangler login` and `"ai": { "binding": "AI", "remote": true }` in `wrangler.jsonc`.

AI-assisted. The prompts used to build this repo are in `PROMPTS.md`.

# Relay

Chat control plane for internal infrastructure, built as the Cloudflare Software Engineer take-home.

An operator types what they want. Llama 3.3 on Workers AI extracts a structured job. A Cloudflare Workflow runs it as durable steps. The desk (a Durable Object) remembers the last job so “restart the last one” works. D1 is the fake fleet.

This is a mock control plane, not a cloud provider. Provisioning writes rows and endpoints, not real machines. That is the point: treat ops as a software problem.

## Assignment map

| Required | Here |
| --- | --- |
| LLM | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI |
| Workflow / coordination | `InfraWorkflow` — validate → allocate → configure → healthcheck |
| Chat | Pages UI + Agents SDK (`RelayAgent`) |
| Memory / state | Durable Object chat + `RelayState` last-job memory; D1 inventory |
| Prompt history | [`PROMPTS.md`](./PROMPTS.md) |

## 30-second demo

```bash
pnpm install
pnpm types
pnpm dev
```

Open the printed localhost URL, then:

1. `Spin up a staging Redis for payments, 1GB, London`
2. Wait for the job panel to go `complete` and `payments-cache` to show `running` on the fleet.
3. `What's on the fleet?`
4. `Restart the last one`
5. `Tear down payments-cache` — confirm in the approval card.

Name a resource `broken-cache` to watch healthcheck retries fail.

## Why Workflows instead of one Worker

A single request cannot honestly represent provision → healthcheck → persist. If the isolate dies mid-way, you want to resume after `allocate`, not redo it. `step.do` checkpoints that. The chat agent only dispatches; it does not pretend to be the control plane.

## Layout

- `src/server.ts` — `RelayAgent` (tools + Llama) and HTTP (`/api/desk`, `/api/jobs/:id`)
- `src/workflow.ts` — durable infra job
- `src/inventory.ts` — D1 fleet + job log
- `src/app.tsx` — ops desk UI

## Deploy

Needs a Cloudflare account. Create a D1 database, put its id in `wrangler.jsonc`, then:

```bash
wrangler login
pnpm deploy
```

Local `pnpm dev` does not need an account for the UI and workflows. Llama 3.3 (Workers AI) needs `wrangler login` and `"ai": { "binding": "AI", "remote": true }` in `wrangler.jsonc`.

AI-assisted. The prompts used to build this repo are in `PROMPTS.md`.

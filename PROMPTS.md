# Prompt history

Cloudflare asked for the prompts used to build this assignment. This is that record.

Tool: Cursor (Grok 4.6), 20 Sep 2026.

## Job

https://job-boards.greenhouse.io/cloudflare/jobs/8212060

Optional fast-track: an AI app on Cloudflare with LLM, workflow/coordination, chat or voice, and memory. AI-assisted coding encouraged; prompt history required.

Docs they linked: https://agents.cloudflare.com/ and https://developers.cloudflare.com/agents/

## Conversation (abridged, in order)

### User
Open the Greenhouse posting.

### Assistant
Opened it. Hybrid Software Engineer, internal platforms / infra tools. Optional assignment: AI app on Cloudflare, submit GitHub URL + prompt history.

### User
Can I apply? (resume attached)

### Assistant
Yes. Posting location is Bengaluru / Remote India. Skills match on Go/Java backends; gap is Terraform/Ansible. Do the assignment if you want it to be more than a resume lottery.

### User
assignment?

### Assistant
Optional fast-track. Build an AI app with:
1. LLM (Llama 3.3 on Workers AI, or external)
2. Workflows / Workers / Durable Objects
3. Chat or voice (Pages or Realtime)
4. Memory or state
Starter: `npx create-cloudflare@latest --template cloudflare/agents-starter`
Must include prompt history.

### User
can u create an application? if yes what would it be?

### Assistant
Yes. Build **Relay**: a chat control plane for infra ops.
Example: “Spin up a staging Redis for payments, 1GB, eu-west.”
Llama extracts intent → Workflow runs validate/allocate/configure/healthcheck → Pages chat → Durable Object + D1 memory.
Repo working title: `relay-ops`. Not inside itstillworks.app.

### User
why relay-ops?

### Assistant
The product is the reason; the name is not. Relay = a desk that coordinates work. `-ops` is so a recruiter sees the job on GitHub. Rename if you want.

### User
okie build it

### Assistant
Scaffolded this repo from the Cloudflare Agents + Workflows APIs (not a reskin of `agents-starter`). Used:
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- `AIChatAgent` + tools (`dispatchJob`, `listFleet`, `getJobStatus`, `recallContext`)
- `InfraWorkflow` with `step.do` / `step.sleep` / retries
- D1 inventory, Durable Object last-job state, Pages chat UI

Follow-up prompts in this same session (install, typecheck, UI fixes) belong below as they happen.

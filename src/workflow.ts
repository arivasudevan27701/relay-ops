import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
  countLive,
  endpointFor,
  ensureSchema,
  getByName,
  insertResource,
  patchResource,
  upsertJob
} from "./inventory";
import { MAX_RESOURCES, type JobParams, type ResourceRow } from "./types";

const STEP_RETRY = { retries: { limit: 3, delay: "1 second" as const, backoff: "linear" as const } };

export class InfraWorkflow extends WorkflowEntrypoint<Env, JobParams> {
  async run(event: WorkflowEvent<JobParams>, step: WorkflowStep) {
    const params = event.payload;
    const jobId = event.instanceId;

    await step.do("ensure schema", async () => {
      await ensureSchema(this.env.DB);
      await upsertJob(this.env.DB, {
        id: jobId,
        deskId: params.deskId,
        action: params.action,
        resourceName: params.name,
        status: "running",
        detail: "accepted"
      });
      return { ok: true };
    });

    try {
      const result =
        params.action === "provision"
          ? await this.provision(step, params, jobId)
          : params.action === "restart"
            ? await this.restart(step, params, jobId)
            : params.action === "teardown"
              ? await this.teardown(step, params, jobId)
              : await this.status(step, params, jobId);

      await step.do("record success", async () => {
        await upsertJob(this.env.DB, {
          id: jobId,
          deskId: params.deskId,
          action: params.action,
          resourceName: params.name,
          status: "complete",
          detail: JSON.stringify(result)
        });
        return { ok: true };
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.do("record failure", async () => {
        await upsertJob(this.env.DB, {
          id: jobId,
          deskId: params.deskId,
          action: params.action,
          resourceName: params.name,
          status: "errored",
          detail: message
        });
        return { ok: true };
      });
      throw error;
    }
  }

  private async provision(step: WorkflowStep, params: JobParams, jobId: string) {
    const existing = await step.do("validate", async () => {
      const current = await getByName(this.env.DB, params.deskId, params.name);
      if (current) {
        return {
          duplicate: true as const,
          resource: current
        };
      }
      const live = await countLive(this.env.DB, params.deskId);
      if (live >= MAX_RESOURCES) {
        throw new Error(`quota exceeded: desk ${params.deskId} already has ${live} resources`);
      }
      return { duplicate: false as const };
    });

    if (existing.duplicate) {
      return {
        ok: true,
        idempotent: true,
        message: `resource ${params.name} already exists`,
        resource: existing.resource
      };
    }

    await step.sleep("wait for allocator", "1 second");

    const allocated = await step.do("allocate", async () => {
      const now = new Date().toISOString();
      const row: ResourceRow = {
        id: crypto.randomUUID(),
        desk_id: params.deskId,
        kind: params.kind,
        name: params.name,
        team: params.team,
        region: params.region,
        size: params.size,
        status: "allocating",
        endpoint: null,
        created_at: now,
        updated_at: now
      };
      await insertResource(this.env.DB, row);
      await upsertJob(this.env.DB, {
        id: jobId,
        deskId: params.deskId,
        action: params.action,
        resourceName: params.name,
        status: "running",
        detail: "allocated"
      });
      return row;
    });

    await step.sleep("wait for config plane", "1 second");

    const configured = await step.do("configure", async () => {
      const endpoint = endpointFor(params.kind, params.name, params.region);
      await patchResource(this.env.DB, allocated.id, {
        status: "configuring",
        endpoint
      });
      return { ...allocated, endpoint, status: "configuring" as const };
    });

    const healthy = await step.do("healthcheck", STEP_RETRY, async () => {
      if (params.name.includes("broken")) {
        throw new Error(`healthcheck failed for ${params.name}: mock probe refused`);
      }
      await patchResource(this.env.DB, configured.id, { status: "running" });
      return { ok: true, endpoint: configured.endpoint };
    });

    return {
      ok: true,
      jobId,
      resource: {
        id: configured.id,
        name: params.name,
        kind: params.kind,
        team: params.team,
        region: params.region,
        size: params.size,
        endpoint: healthy.endpoint,
        status: "running"
      }
    };
  }

  private async restart(step: WorkflowStep, params: JobParams, jobId: string) {
    const found = await step.do("find resource", async () => {
      const row = await getByName(this.env.DB, params.deskId, params.name);
      if (!row) throw new Error(`no live resource named ${params.name}`);
      await patchResource(this.env.DB, row.id, { status: "restarting" });
      return row;
    });

    await step.sleep("drain connections", "1 second");

    await step.do("healthcheck after restart", STEP_RETRY, async () => {
      if (params.name.includes("broken")) {
        await patchResource(this.env.DB, found.id, { status: "failed" });
        throw new Error(`restart healthcheck failed for ${params.name}`);
      }
      await patchResource(this.env.DB, found.id, { status: "running" });
      await upsertJob(this.env.DB, {
        id: jobId,
        deskId: params.deskId,
        action: params.action,
        resourceName: params.name,
        status: "running",
        detail: "healthcheck passed"
      });
      return { ok: true };
    });

    return {
      ok: true,
      jobId,
      resource: { ...found, status: "running" }
    };
  }

  private async teardown(step: WorkflowStep, params: JobParams, _jobId: string) {
    const found = await step.do("find resource", async () => {
      const row = await getByName(this.env.DB, params.deskId, params.name);
      if (!row) throw new Error(`no live resource named ${params.name}`);
      await patchResource(this.env.DB, row.id, { status: "draining" });
      return row;
    });

    await step.sleep("drain before destroy", "1 second");

    await step.do("destroy", async () => {
      await patchResource(this.env.DB, found.id, { status: "gone", endpoint: null });
      return { ok: true };
    });

    return { ok: true, destroyed: found.name, id: found.id };
  }

  private async status(step: WorkflowStep, params: JobParams, _jobId: string) {
    return await step.do("probe", async () => {
      const row = await getByName(this.env.DB, params.deskId, params.name);
      if (!row) return { ok: false, message: `no live resource named ${params.name}` };
      return {
        ok: true,
        probe: row.status === "running" ? "healthy" : row.status,
        resource: row
      };
    });
  }
}

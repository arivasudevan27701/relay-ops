import { describe, expect, it } from "vitest";
import { parseLlamaJson } from "./extract";
import { parseOps } from "./intent";
import type { RelayState } from "./types";

const empty: RelayState = {
  lastJobId: null,
  lastAction: null,
  lastResourceName: null,
  pendingTeardown: null
};

describe("parseOps", () => {
  it("maps a London payments Redis to lhr + payments-cache", () => {
    const intent = parseOps("Spin up a staging Redis for payments, 1GB, London", empty);
    expect(intent).toMatchObject({
      type: "job",
      action: "provision",
      kind: "redis",
      name: "payments-cache",
      region: "lhr",
      size: "small"
    });
  });

  it("restarts lastResourceName", () => {
    const intent = parseOps("Restart the last one", {
      ...empty,
      lastResourceName: "payments-cache"
    });
    expect(intent).toMatchObject({
      type: "job",
      action: "restart",
      name: "payments-cache"
    });
  });

  it("lists the fleet", () => {
    expect(parseOps("What's on the fleet?", empty)).toEqual({ type: "list" });
  });

  it("tears down a named resource without treating it as approved", () => {
    const intent = parseOps("Tear down payments-cache", empty);
    expect(intent).toMatchObject({ type: "job", action: "teardown", name: "payments-cache" });
  });

  it("treats a greeting as chat", () => {
    expect(parseOps("Hi", empty)).toEqual({ type: "chat" });
  });

  it("approves pending teardown locally", () => {
    const intent = parseOps("approve teardown", {
      ...empty,
      pendingTeardown: "payments-cache"
    });
    expect(intent).toMatchObject({ type: "job", action: "teardown", name: "payments-cache" });
  });
});

describe("parseLlamaJson", () => {
  it("accepts valid Llama job JSON", () => {
    expect(
      parseLlamaJson(
        '{"type":"job","action":"provision","kind":"redis","name":"payments-cache","region":"lhr","size":"small"}'
      )
    ).toMatchObject({
      type: "job",
      action: "provision",
      name: "payments-cache",
      region: "lhr",
      team: "platform"
    });
  });

  it("accepts fenced JSON", () => {
    expect(parseLlamaJson('```json\n{"type":"list"}\n```')).toEqual({ type: "list" });
  });

  it("rejects junk so the regex fallback can run", () => {
    expect(parseLlamaJson("not json")).toBeNull();
    expect(parseLlamaJson('{"type":"job","action":"explode"}')).toBeNull();
    expect(parseLlamaJson('{"type":"job","action":"provision","kind":"redis","name":"x","region":"eu-west","size":"small"}')).toBeNull();
  });
});

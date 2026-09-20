import { describe, expect, it } from "vitest";
import { startNewChat, type ChatSession } from "./sessions";

describe("startNewChat", () => {
  it("opens a new id even when the current draft is already empty", () => {
    const current: ChatSession = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", title: "", updatedAt: 1 };
    const titled: ChatSession = {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      title: "Hi",
      updatedAt: 2
    };
    const next = startNewChat([current, titled]);
    expect(next.activeId).not.toBe(current.id);
    expect(next.sessions[0]?.title).toBe("");
    expect(next.sessions.map((row) => row.id)).toContain(titled.id);
    expect(next.sessions.map((row) => row.id)).not.toContain(current.id);
  });
});

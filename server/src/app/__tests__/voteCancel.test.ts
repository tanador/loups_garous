import { describe, it, expect } from "vitest";
import { Orchestrator } from "../orchestrator.js";
import { createGame, addPlayer } from "../../domain/game.js";
import { assignRoles } from "../../domain/rules.js";

function fakeIo(calls: any[]) {
  return {
    to: () => ({
      emit: (_event: string, _data: any) => calls.push({ event: _event, data: _data }),
    }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

describe("vote cancel", () => {
  it("allows a player to retract and revote", () => {
    const calls: any[] = [];
    const orch = new Orchestrator(fakeIo(calls));
    const g = createGame(3);
    addPlayer(g, { id: "A", socketId: "sA" });
    addPlayer(g, { id: "B", socketId: "sB" });
    addPlayer(g, { id: "C", socketId: "sC" });
    assignRoles(g);
    (orch as any).store.put(g);
    g.state = "VOTE";

    orch.voteCast(g.id, "A", "B");
    expect(g.votes["A"]).toBe("B");
    orch.voteCancel(g.id, "A");
    expect(g.votes["A"]).toBeUndefined();
    orch.voteCast(g.id, "A", "C");
    expect(g.votes["A"]).toBe("C");
  });
});

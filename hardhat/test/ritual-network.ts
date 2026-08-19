import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublicClient } from "viem";

import { RITUAL, assertRitualNetwork } from "../scripts/ritual.ts";

type FakePublicClient = Pick<PublicClient, "getChainId" | "getCode" | "readContract">;

function fakeClient(overrides: Partial<FakePublicClient> = {}): PublicClient {
  const base: FakePublicClient = {
    getChainId: async () => RITUAL.chainId,
    getCode: async () => "0x6001600055",
    readContract: async () => 0n,
  } as FakePublicClient;

  return { ...base, ...overrides } as PublicClient;
}

describe("Ritual RPC identity guard", () => {
  it("accepts chain 1979 only when the canonical RitualWallet is callable", async () => {
    await assert.doesNotReject(assertRitualNetwork(fakeClient()));
  });

  it("rejects a different chain ID", async () => {
    const client = fakeClient({ getChainId: async () => 1 });

    await assert.rejects(
      assertRitualNetwork(client),
      /Wrong chain: expected Ritual chain ID 1979, got 1/,
    );
  });

  it("rejects chain-ID collisions that do not contain RitualWallet", async () => {
    const client = fakeClient({ getCode: async () => "0x" });

    await assert.rejects(
      assertRitualNetwork(client),
      /Chain ID 1979 is not unique; refusing to treat this RPC as Ritual/,
    );
  });

  it("rejects code at the canonical address when the RitualWallet ABI probe fails", async () => {
    const client = fakeClient({
      readContract: async () => {
        throw new Error("execution reverted");
      },
    });

    await assert.rejects(
      assertRitualNetwork(client),
      /RitualWallet ABI probe failed/,
    );
  });
});

# Local Proof of Building

Date: 2026-08-19

This file records the local baseline observed before source changes and the verification state after the fork work.

## Upstream baseline

Repository state was clean immediately after forking and cloning.

### Dependency setup

The machine initially had no `pnpm` executable. Enabling Corepack selected `pnpm 11.22.0`, but the untouched repository did not pin a package-manager version. Its frozen install ended with:

```text
ERR_PNPM_IGNORED_BUILDS
Ignored build scripts: esbuild@0.28.2
```

The generated `pnpm-workspace.yaml` was removed afterward so the source tree returned to the untouched state. The fork now pins `pnpm@10.15.1` in `package.json`.

### Build before changes

Running the local Hardhat CLI directly produced:

```text
Compiled 2 Solidity files with solc 0.8.28 (evm target: cancun)
```

Compilation succeeded because Solidity permits the five empty starter function bodies, even though the documented market lifecycle was not implemented.

### Tests before changes

The only TypeScript test was the stale Hardhat `Counter` template. Full test output ended with:

```text
2 failing (2 nodejs)
HardhatError: HHE1000: Artifact for contract "Counter" not found.
```

Solidity-only baseline:

```text
0 passing
```

TypeScript also failed with `TS5097` for `.ts` import paths plus a stale `Counter.ts` typing error.

## What was implemented

- Completed all five missing `RitualPredict` lifecycle functions.
- Added real Scheduler retry scheduling and cancellation.
- Added TEE executor selection through `TEEServiceRegistry`.
- Added Ritual HTTP short-running async request encoding and response decoding.
- Added JQ `uint256` extraction and explicit failure handling.
- Added pull-based resolution/refund coverage and duplicate replay idempotency.
- Added local mocks at Ritual's canonical system/precompile addresses.
- Added permissionless liveness rescue after the final retry + Scheduler TTL.
- Added adversarial tests including unauthorized resolution, malformed async data, empty JQ output, missing executor, reentrancy, and rescue boundaries.
- Removed the unrelated failing `Counter` template.
- Aligned Hardhat environment loading and TypeScript configuration with the scripts actually present in the repository.
- Removed stale frontend assumptions from the CLI flow because the upstream fork contains no `web/` directory.

## Current local verification

Expected commands from `hardhat/`:

```bash
pnpm build
pnpm typecheck
pnpm test
```

Verified result during development:

```text
Hardhat build: PASS
TypeScript: PASS
Solidity tests: 16 passing
Full Hardhat test task: PASS
Local Hardhat node demo: PASS
```

The test suite runs against local mocks only and does not require a funded wallet or live Ritual RPC.

## Explicit local-node run

A standalone Hardhat node was started and `scripts/local-demo.ts` was executed against `localhost`. The script installed the Ritual mock runtimes at their canonical addresses, then exercised the complete user flow.

Observed output:

```text
RitualPredict: 0x2279b7a0a67db372996a5fab50d91eaa73d2ebe6
Market #1: Will ETH clear 4,000?
Schedule id: 1
Alice: 2 RITUAL YES
Bob:   1 RITUAL NO
State: 3 (3 = Resolved)
Outcome: 1 (1 = YES)
Observed: 4100
Alice claimable: 3 RITUAL
Winner claimed successfully; market pool balance is 0.
LOCAL DEMO PASS
```

The node process was stopped after the successful run. The shown contract address is a disposable local Hardhat address, not a Ritual testnet deployment.

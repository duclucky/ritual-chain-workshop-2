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

The generated baseline `pnpm-workspace.yaml` was removed afterward so the source tree returned to the untouched state. The fork now pins `pnpm@10.15.1` in `package.json` and intentionally adds `pnpm-workspace.yaml` with `onlyBuiltDependencies: [esbuild]`. A fresh frozen install ran the `esbuild@0.28.2` postinstall successfully and completed with exit code 0.

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
Frozen pnpm install: PASS
Hardhat build: PASS
TypeScript: PASS
Solidity tests: 16 passing
Node.js identity tests: 4 passing
Full Hardhat test task: 20 passing
Local Hardhat node demo: PASS
Frontend frozen install: PASS
Frontend lint: 0 warnings / 0 errors
Frontend production build: PASS
Browser live-contract QA: PASS
```

The test suite runs against local mocks only and does not require a funded wallet or live Ritual RPC.

## Explicit local-node run

A standalone Hardhat node was started with `hardhat node --chain-id 1979` and `scripts/local-demo.ts` was executed against `localhost`. The script installed the Ritual mock runtimes at their canonical addresses, verified the Ritual network identity guard, then exercised the complete user flow.

Observed output:

```text
Ritual network identity guard: PASS
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

## Ritual testnet RPC availability on 2026-08-19

The canonical endpoint configured by the starter is `https://rpc.ritualfoundation.org`. During this work, independent DNS queries through both Cloudflare (1.1.1.1) and Google (8.8.8.8) resolved that hostname to `162.255.119.231`. A plain HTTP request reached that host but returned a `301` redirect to `https://ritualfoundation.org` with `X-Served-By: Namecheap URL Forward`; HTTPS JSON-RPC connections to port 443 timed out/reset from this machine. `explorer.ritualfoundation.org` resolved to the same forwarding IP and showed the same HTTP redirect behavior.

Because chain ID `1979` is also used by another public EVM testnet, the project now refuses to trust chain ID alone. A candidate RPC with chain ID 1979 was deliberately probed and rejected because the canonical RitualWallet address `0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948` had no bytecode there. `connectRitual()` now verifies chain ID, RitualWallet bytecode, and a `balanceOf` ABI call before any live deployment script proceeds.

No Ritual testnet contract address or transaction hash is claimed in this repository because a real deployment could not be verified through the canonical RPC on this date. The local proof above is intentionally labeled as local Hardhat execution, not production/testnet proof.


## Frontend proof

A React 19 + Vite 8 frontend was added under `web/` and connected to the actual `RitualPredict` ABI with viem. UI/UX Pro Max generated the persisted design system in `design-system/ritual-predict/MASTER.md`.

Browser QA was run against a live local Hardhat node (chain ID 1979) after `local-demo.ts` seeded the canonical Ritual mocks and deployed the contract. Observed browser state:

```text
Live contract
Verified Ritual-compatible chain and RitualPredict bytecode
Markets shown: 1 (On-chain)
Visible pool: 3 RITUAL
Execution balance: 0.5 RITUAL
Market #1: Resolved YES
Observed value: 4100
```

The browser console contained no runtime errors on the live path. Negative UX checks also verified invalid contract-address feedback, missing injected-wallet feedback, inline create-market form errors, Escape-to-close, and clearly labelled Preview fallback when RPC access fails.

Evidence:

- [Live local dashboard](screenshots/ritual-predict-web-live.png)
- [Create-market validation](screenshots/create-market-validation.png)

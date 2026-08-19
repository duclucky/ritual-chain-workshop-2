# Ritual Predict contracts

`RitualPredict` is a binary pari-mutuel prediction market that schedules its own resolution on Ritual Chain. At resolution time it selects an HTTP-capable TEE executor, calls the HTTP precompile, extracts a `uint256` with the JQ precompile, and either settles the winning side or invalidates the market for refunds.

## What this fork fixes

The upstream starter contained five unimplemented lifecycle functions and stale Hardhat template tests. This fork completes the lifecycle and adds a local Ritual harness so the documented flow can be exercised without a live testnet.

The custom extension is a permissionless liveness rescue. If Scheduler never executes any booked retry, a market would otherwise keep funds locked forever because the attempt counter never advances. `rescueExpiredMarket()` becomes available only after the last scheduled retry plus its Scheduler TTL has passed. It then invalidates the market and unlocks pull-based refunds. It cannot run early or overwrite an already finalized outcome.

## Layout

```text
contracts/
  RitualPredict.sol              market lifecycle, autonomous resolution, payouts, rescue path
  RitualPredict.t.sol            Solidity unit and adversarial tests
  ritual/RitualChain.sol         canonical Ritual addresses and interfaces
  mocks/RitualMocks.sol          local Scheduler, wallet, TEE, HTTP, and JQ stand-ins
scripts/
  block-time.ts                  measure current Ritual block time
  deploy.ts                      deploy and prepay execution fees
  fund.ts                        top up prepaid execution balance
  status.ts                      print live market and Scheduler state
  create-demo-market.ts          create a market against a public JSON oracle
  market-presets.ts              CLI market defaults
  local-demo.ts                   end-to-end flow against a local Hardhat node
```

## Local verification

Node.js 20+ is required. The project pins `pnpm@10.15.1` for reproducible installs. `pnpm-workspace.yaml` explicitly approves only the `esbuild` dependency build script required by the toolchain.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

Current local suite: **20 tests**: 16 Solidity tests plus 4 Node.js network-identity tests. It covers:

- market creation and immutable resolution rules;
- block-number betting deadlines;
- Scheduler-only resolution authorization;
- TEE executor selection failure;
- HTTP error, revert, and malformed async-envelope handling;
- empty JQ output handling;
- retry exhaustion and refunds;
- successful YES resolution and payout;
- empty winning-side invalidation;
- duplicate Scheduler replay idempotency;
- pull-payment reentrancy resistance;
- RitualWallet execution funding;
- early-rescue rejection;
- permissionless rescue when Scheduler never runs;
- protection against rescue overwriting a resolved market;
- RPC identity checks that reject wrong chain IDs, chain-ID collisions, and fake RitualWallet contracts.

The tests use `vm.etch` to install mocks at Ritual's canonical system/precompile addresses, so local validation does not require a funded account or live RPC.

For an explicit local-node walkthrough, run these in two terminals:

```bash
pnpm hardhat node --chain-id 1979
pnpm hardhat run scripts/local-demo.ts
```

`local-demo.ts` installs mock runtimes at the canonical Ritual addresses, verifies the Ritual network identity guard, deploys `RitualPredict`, creates a market, places YES/NO bets, resolves through the Scheduler + HTTP + JQ path, claims the winning payout, and exits with `LOCAL DEMO PASS`. The explicit `--chain-id 1979` is required because Hardhat node defaults to 31337.

## Network identity safety

Chain ID `1979` is not globally unique. Before any live script proceeds, `connectRitual()` verifies all three signals: the reported chain ID, bytecode at the canonical RitualWallet address, and a successful `balanceOf` ABI probe. This prevents a reachable non-Ritual RPC that happens to use chain ID 1979 from being mistaken for Ritual.

## Ritual testnet configuration

Copy the tracked example file and provide a funded testnet key locally. Never commit the resulting `.env` file.

```bash
cp .env.example .env
```

The canonical key variable is `DEPLOYER_PRIVATE_KEY`; `RITUAL_PRIVATE_KEY` remains accepted as a backwards-compatible fallback in `hardhat.config.ts`.

Useful commands:

```bash
pnpm hardhat run scripts/block-time.ts
pnpm hardhat run scripts/deploy.ts
PREDICT_ADDRESS=0x... ORACLE_URL=https://public.example/price pnpm hardhat run scripts/create-demo-market.ts
PREDICT_ADDRESS=0x... pnpm hardhat run scripts/status.ts
PREDICT_ADDRESS=0x... pnpm hardhat run scripts/fund.ts
```

`ORACLE_URL` must be an HTTP(S) endpoint reachable from the public internet. `localhost` is intentionally rejected because the TEE executor cannot reach the developer machine.

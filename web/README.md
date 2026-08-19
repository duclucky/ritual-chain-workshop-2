# Ritual Predict Web

A reviewer-facing React/Vite frontend for the Bootcamp 2 fork. The UI is intentionally useful in two modes:

- **Live contract mode**: reads `RitualPredict` from a configured RPC/address and enables wallet actions.
- **Preview mode**: if Ritual RPC is unavailable, shows clearly labelled illustrative market data while all on-chain writes remain disabled.

## Run the UI only

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Optional Vite variables:

```text
VITE_RPC_URL=https://rpc.ritualfoundation.org
VITE_PREDICT_ADDRESS=0x...
```

You can also set RPC URL and contract address directly from the Runtime Connection panel in the page.

## Full local Ritual flow

Terminal 1:

```bash
cd hardhat
pnpm hardhat node --chain-id 1979
```

Terminal 2:

```bash
cd hardhat
pnpm hardhat run scripts/local-demo.ts
```

`local-demo.ts` installs the Ritual mocks at canonical addresses, deploys `RitualPredict`, runs the autonomous resolution flow, and writes `web/public/local-demo.json` with the local contract address. That file is generated and gitignored.

Terminal 3:

```bash
cd web
pnpm dev
```

The web app automatically reads the generated local runtime config and switches from Preview to Live contract mode.

## Wallet writes

The app uses an injected EIP-1193 wallet for `createMarket`, `bet`, `claimWinnings`, `claimRefund`, and `rescueExpiredMarket`. It requires chain ID `1979`. For local write testing, configure the wallet against `http://127.0.0.1:8545` with chain ID `1979` and use a local Hardhat account.

## UX rules applied

The UI follows the persisted `design-system/ritual-predict/MASTER.md` generated with UI/UX Pro Max: dark OLED/high-trust dashboard, visible focus, minimum 44px interactive targets, explicit transaction feedback, reduced-motion support, responsive layouts, and clear distinction between preview data and verified chain state.

## Verification

```bash
pnpm lint
pnpm build
```

# Ritual Predict Web

> **Live Web Application**: [https://ritual-predict-core.vercel.app](https://ritual-predict-core.vercel.app)
> **GitHub Repository**: [https://github.com/duclucky/ritual-chain-workshop-2](https://github.com/duclucky/ritual-chain-workshop-2)

A reviewer-facing React/Vite frontend for the Bootcamp 2 fork, styled with a clean and modern Web3 prediction market design language. The UI is intentionally useful in two modes:

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

The app supports all injected EVM wallets (MetaMask, Rabby, OKX, Coinbase, Phantom, Trust Wallet) for `createMarket`, `bet`, `claimWinnings`, `claimRefund`, and `rescueExpiredMarket`. It requires chain ID `1979` and includes automatic network switching and adding. For local write testing, configure the wallet against `http://127.0.0.1:8545` with chain ID `1979` and use a local Hardhat account.

## UX rules applied

The UI follows the clean, modern Web3 design system: Space Grotesk typography, purple-to-emerald gradient hero banner, horizontal category filter ribbon, high-contrast YES/NO binary action buttons with live multiplier calculation, collapsible oracle transparency drawers, visible focus, minimum 44px interactive targets, explicit transaction feedback, reduced-motion support, and responsive layouts.

## Verification

```bash
pnpm lint
pnpm build
```

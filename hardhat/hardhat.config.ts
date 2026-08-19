import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

// Scripts in this workshop also read process.env, so load the local .env once here.
// Missing .env is fine for local compilation/tests, which use the simulated network.
try {
  process.loadEnvFile();
} catch {
  // No local .env file.
}

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.RITUAL_PRIVATE_KEY;

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    ritual: {
      type: "http",
      chainType: "l1",
      chainId: 1979,
      url: process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org",
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
    },
  },
});

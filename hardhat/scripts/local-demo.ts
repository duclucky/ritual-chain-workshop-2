import { network } from "hardhat";
import { formatEther, parseEther, stringToHex } from "viem";
import { assertRitualNetwork } from "./ritual.ts";

const ADDR = {
  scheduler: "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B",
  ritualWallet: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
  teeRegistry: "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F",
  http: "0x0000000000000000000000000000000000000801",
  jq: "0x0000000000000000000000000000000000000803",
} as const;

const { viem } = await network.create({ network: "localhost", chainType: "l1" });
const publicClient = await viem.getPublicClient();
const [deployer, alice, bob] = await viem.getWalletClients();

if (!deployer || !alice || !bob) {
  throw new Error("Local Hardhat node did not expose at least three unlocked accounts.");
}

async function etchRuntime(contractName: string, target: `0x${string}`) {
  const implementation = await viem.deployContract(contractName);
  const runtime = await publicClient.getCode({ address: implementation.address });
  if (!runtime || runtime === "0x") throw new Error(`No runtime bytecode for ${contractName}`);

  await (publicClient.request as any)({
    method: "hardhat_setCode",
    params: [target, runtime],
  });
}

console.log("── Install Ritual local mocks ─────────────────────────────");
await etchRuntime("MockScheduler", ADDR.scheduler);
await etchRuntime("MockRitualWallet", ADDR.ritualWallet);
await etchRuntime("MockTEERegistry", ADDR.teeRegistry);
await etchRuntime("MockHTTPPrecompile", ADDR.http);
await etchRuntime("MockJQPrecompile", ADDR.jq);

const tee = await viem.getContractAt("MockTEERegistry", ADDR.teeRegistry);
const http = await viem.getContractAt("MockHTTPPrecompile", ADDR.http);
const jq = await viem.getContractAt("MockJQPrecompile", ADDR.jq);
const scheduler = await viem.getContractAt("MockScheduler", ADDR.scheduler);

await tee.write.setExecutor([deployer.account.address, true]);
await http.write.setResponse([200, stringToHex('{"price":4100}'), ""]);
await jq.write.setValue([4100n]);

console.log("Mocks installed at canonical Ritual addresses.");
await assertRitualNetwork(publicClient);
console.log("Ritual network identity guard: PASS");

console.log("");
console.log("── Deploy and create market ───────────────────────────────");
const predict = await viem.deployContract("RitualPredict", [1000n]);
console.log(`RitualPredict: ${predict.address}`);

await predict.write.createMarket([
  {
    question: "Will ETH clear 4,000?",
    oracleUrl: "https://local-demo.example/eth",
    jsonPath: ".price",
    target: 4000n,
    comparator: 1,
    bettingSeconds: 30n,
    resolveDelaySeconds: 15n,
  },
]);

const marketId = await predict.read.marketCount();
const created = await predict.read.getMarket([marketId]);
console.log(`Market #${marketId}: ${created.question}`);
console.log(`Schedule id: ${created.scheduleId}`);

console.log("");
console.log("── Place bets ─────────────────────────────────────────────");
await predict.write.bet([marketId, true], { account: alice.account, value: parseEther("2") });
await predict.write.bet([marketId, false], { account: bob.account, value: parseEther("1") });
console.log("Alice: 2 RITUAL YES");
console.log("Bob:   1 RITUAL NO");

console.log("");
console.log("── Scheduler resolves through HTTP + JQ mocks ────────────");
await scheduler.write.execute([predict.address, 0n, marketId]);
const resolved = await predict.read.getMarket([marketId]);
console.log(`State: ${resolved.state} (3 = Resolved)`);
console.log(`Outcome: ${resolved.outcome} (1 = YES)`);
console.log(`Observed: ${resolved.observedValue}`);

if (resolved.state !== 3 || resolved.outcome !== 1 || resolved.observedValue !== 4100n) {
  throw new Error("Local resolution did not reach the expected YES outcome.");
}

const [, , , claimable] = await predict.read.stakesOf([marketId, alice.account.address]);
console.log(`Alice claimable: ${formatEther(claimable)} RITUAL`);
if (claimable !== parseEther("3")) throw new Error("Unexpected pari-mutuel payout.");

await predict.write.claimWinnings([marketId], { account: alice.account });
const contractBalance = await publicClient.getBalance({ address: predict.address });
if (contractBalance !== 0n) throw new Error("Contract pool should be empty after the winner claims.");

console.log("Winner claimed successfully; market pool balance is 0.");
console.log("");
console.log("LOCAL DEMO PASS");

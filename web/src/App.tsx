import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Code2,
  ExternalLink,
  Gauge,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Wallet,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatEther,
  http,
  isAddress,
  parseEther,
  type Address,
  type EIP1193Provider,
} from "viem";
import { ritualPredictAbi } from "./lib/ritualPredictAbi";

const RITUAL_CHAIN_ID = 1979;
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as Address;
const RITUAL_WALLET_ABI = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
const DEFAULT_RPC = import.meta.env.VITE_RPC_URL ?? "https://rpc.ritualfoundation.org";
const DEFAULT_ADDRESS = import.meta.env.VITE_PREDICT_ADDRESS ?? "";

const ritualChain = defineChain({
  id: RITUAL_CHAIN_ID,
  name: "Ritual Chain",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_RPC] } },
});

const MARKET_STATE = ["Open", "Closed", "Resolving", "Resolved", "Invalid"] as const;
const OUTCOME = ["Unresolved", "YES", "NO"] as const;
const COMPARATOR = [">", "≥", "<", "≤"] as const;

type Notice = { tone: "pending" | "success" | "error"; text: string } | null;
type StakeInfo = { yes: bigint; no: bigint; settled: boolean; claimable: bigint };

type MarketView = {
  id: bigint;
  creator: Address;
  question: string;
  oracleUrl: string;
  jsonPath: string;
  target: bigint;
  comparator: number;
  closeBlock: bigint;
  resolveBlock: bigint;
  scheduleId: bigint;
  totalYes: bigint;
  totalNo: bigint;
  state: number;
  outcome: number;
  attempts: number;
  observedValue: bigint;
  invalidReason: string;
  rescueBlock?: bigint;
  stake?: StakeInfo;
  preview?: boolean;
};

type LocalDemoConfig = { address?: Address; rpcUrl?: string; chainId?: number };

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const previewMarkets: MarketView[] = [
  {
    id: 3n,
    creator: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    question: "Will ETH/USD be at least $4,000 when this market resolves?",
    oracleUrl: "https://oracle.example/eth",
    jsonPath: ".price",
    target: 4000n,
    comparator: 1,
    closeBlock: 125840n,
    resolveBlock: 125910n,
    scheduleId: 12n,
    totalYes: parseEther("8.4"),
    totalNo: parseEther("4.1"),
    state: 0,
    outcome: 0,
    attempts: 0,
    observedValue: 0n,
    invalidReason: "",
    preview: true,
  },
  {
    id: 2n,
    creator: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    question: "Will BTC stay above $110,000 at resolution?",
    oracleUrl: "https://oracle.example/btc",
    jsonPath: ".price",
    target: 110000n,
    comparator: 1,
    closeBlock: 125100n,
    resolveBlock: 125180n,
    scheduleId: 11n,
    totalYes: parseEther("5"),
    totalNo: parseEther("3"),
    state: 3,
    outcome: 1,
    attempts: 1,
    observedValue: 112420n,
    invalidReason: "",
    preview: true,
  },
];

function shortAddress(value?: string) {
  if (!value) return "Not set";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatRitual(value: bigint) {
  const n = Number(formatEther(value));
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} RITUAL`;
}

function stateTone(state: number) {
  if (state === 3) return "success";
  if (state === 4) return "danger";
  if (state === 2) return "warning";
  return "neutral";
}

function App() {
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC);
  const [contractInput, setContractInput] = useState(DEFAULT_ADDRESS);
  const [contractAddress, setContractAddress] = useState<Address | null>(
    isAddress(DEFAULT_ADDRESS) ? (DEFAULT_ADDRESS as Address) : null,
  );
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null);
  const [executionBalance, setExecutionBalance] = useState<bigint>(0n);
  const [live, setLive] = useState(false);
  const [networkReason, setNetworkReason] = useState("Checking Ritual RPC…");
  const [account, setAccount] = useState<Address | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [betAmounts, setBetAmounts] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);

  const publicClient = useMemo(
    () => createPublicClient({ chain: ritualChain, transport: http(rpcUrl, { timeout: 8_000 }) }),
    [rpcUrl],
  );

  useEffect(() => {
    if (DEFAULT_ADDRESS) return;
    fetch("/local-demo.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("No local demo"))))
      .then((config: LocalDemoConfig) => {
        if (config.rpcUrl) setRpcUrl(config.rpcUrl);
        if (config.address && isAddress(config.address)) {
          setContractInput(config.address);
          setContractAddress(config.address);
        }
      })
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const chainId = await publicClient.getChainId();
      if (chainId !== RITUAL_CHAIN_ID) throw new Error(`RPC returned chain ID ${chainId}, expected ${RITUAL_CHAIN_ID}.`);

      const ritualWalletCode = await publicClient.getCode({ address: RITUAL_WALLET });
      if (!ritualWalletCode || ritualWalletCode === "0x") {
        throw new Error("Chain ID matches, but the canonical RitualWallet is missing.");
      }
      await publicClient.readContract({ address: RITUAL_WALLET, abi: RITUAL_WALLET_ABI, functionName: "balanceOf", args: [RITUAL_WALLET] });

      if (!contractAddress) {
        setLive(false);
        setNetworkReason("Ritual-compatible RPC detected. Add a RitualPredict address to load markets.");
        setMarkets([]);
        return;
      }

      const code = await publicClient.getCode({ address: contractAddress });
      if (!code || code === "0x") throw new Error("No contract bytecode exists at the configured address.");

      const [rawMarkets, latestBlock, fees] = await Promise.all([
        publicClient.readContract({ address: contractAddress, abi: ritualPredictAbi, functionName: "getMarkets" }),
        publicClient.getBlockNumber(),
        publicClient.readContract({ address: contractAddress, abi: ritualPredictAbi, functionName: "executionBalance" }),
      ]);

      const normalized = await Promise.all(
        (rawMarkets as readonly any[]).map(async (m): Promise<MarketView> => {
          let stake: StakeInfo | undefined;
          if (account) {
            const s = (await publicClient.readContract({
              address: contractAddress,
              abi: ritualPredictAbi,
              functionName: "stakesOf",
              args: [m.id, account],
            })) as readonly [bigint, bigint, boolean, bigint];
            stake = { yes: s[0], no: s[1], settled: s[2], claimable: s[3] };
          }
          const rescueBlock = (await publicClient.readContract({
            address: contractAddress,
            abi: ritualPredictAbi,
            functionName: "resolutionDeadline",
            args: [m.id],
          })) as bigint;
          return { ...m, attempts: Number(m.attempts), state: Number(m.state), outcome: Number(m.outcome), comparator: Number(m.comparator), stake, rescueBlock };
        }),
      );

      setMarkets(normalized);
      setBlockNumber(latestBlock);
      setExecutionBalance(fees as bigint);
      setLive(true);
      setNetworkReason(`Verified Ritual-compatible chain and RitualPredict bytecode at ${shortAddress(contractAddress)}.`);
    } catch (error) {
      setLive(false);
      setMarkets([]);
      const raw = error instanceof Error ? error.message : "RPC unavailable.";
      const friendly = /failed to fetch|http request failed|timeout|network/i.test(raw)
        ? `RPC unavailable at ${rpcUrl}. Check the URL or use the local Hardhat flow.`
        : raw.split("\n")[0];
      setNetworkReason(friendly);
    } finally {
      setLoading(false);
    }
  }, [account, contractAddress, publicClient, rpcUrl]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [refresh]);

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice({ tone: "error", text: "No injected wallet found. Install a wallet that supports EIP-1193." });
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainIdHex, 16);
      if (chainId !== RITUAL_CHAIN_ID) throw new Error(`Wallet is on chain ${chainId}. Switch it to Ritual chain ID ${RITUAL_CHAIN_ID}.`);
      setAccount(accounts[0] ?? null);
      setNotice({ tone: "success", text: `Wallet connected: ${shortAddress(accounts[0])}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Wallet connection failed." });
    }
  }

  async function runTransaction(label: string, request: { functionName: string; args?: readonly unknown[]; value?: bigint }) {
    if (!window.ethereum || !account || !contractAddress || !live) {
      setNotice({ tone: "error", text: "Connect a wallet and verify a live RitualPredict contract first." });
      return;
    }
    setNotice({ tone: "pending", text: `${label}: waiting for wallet confirmation…` });
    try {
      const walletClient = createWalletClient({ account, chain: ritualChain, transport: custom(window.ethereum) });
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: ritualPredictAbi,
        functionName: request.functionName as any,
        args: request.args as any,
        value: request.value,
      } as any);
      setNotice({ tone: "pending", text: `${label}: transaction submitted ${shortAddress(hash)}. Waiting for confirmation…` });
      await publicClient.waitForTransactionReceipt({ hash });
      setNotice({ tone: "success", text: `${label}: confirmed on-chain.` });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : `${label} failed.` });
    }
  }

  function applyConnection() {
    if (contractInput && !isAddress(contractInput)) {
      setNotice({ tone: "error", text: "Contract address is not a valid EVM address." });
      return;
    }
    setContractAddress(contractInput ? (contractInput as Address) : null);
    setNotice({ tone: "pending", text: "Connection settings updated. Verifying RPC and contract…" });
  }

  const displayedMarkets = live && markets.length ? markets : previewMarkets;
  const totalPool = displayedMarkets.reduce((sum, market) => sum + market.totalYes + market.totalNo, 0n);
  const activeMarkets = displayedMarkets.filter((m) => m.state === 0 || m.state === 1 || m.state === 2).length;

  return (
    <main className="app-shell">
      <a className="skip-link" href="#markets">Skip to markets</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Ritual Predict home">
          <span className="brand-mark"><Zap size={18} aria-hidden="true" /></span>
          <span><strong>Ritual Predict</strong><small>Self-resolving markets</small></span>
        </a>
        <div className="topbar-actions">
          <div className={`network-pill ${live ? "is-live" : "is-offline"}`}>
            {live ? <Activity size={15} /> : <WifiOff size={15} />}
            <span>{live ? "Live contract" : "Preview"}</span>
          </div>
          <button className="button secondary" onClick={connectWallet}>
            <Wallet size={17} /> {account ? shortAddress(account) : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><Sparkles size={15} /> Autonomous resolution, no keeper</div>
        <div className="hero-grid">
          <div>
            <h1>Markets that wake up,<br />read the world, and settle themselves.</h1>
            <p className="hero-copy">Ritual Scheduler triggers resolution. A TEE executor performs the HTTP request. JQ extracts the value. The contract settles YES or NO, retries safely, and unlocks refunds if liveness fails.</p>
            <div className="hero-actions">
              <button className="button primary" onClick={() => setShowCreate(true)} disabled={!live}><Plus size={17} /> Create market</button>
              <a className="button ghost" href="#resolution-engine">Inspect resolution engine <ArrowRight size={16} /></a>
            </div>
          </div>
          <div className="hero-proof-card">
            <div className="proof-row"><ShieldCheck size={18} /><span><strong>Permissionless rescue</strong><small>Funds cannot remain locked after the final Scheduler window.</small></span></div>
            <div className="proof-row"><RotateCcw size={18} /><span><strong>3 scheduled attempts</strong><small>Oracle failure never silently becomes a NO outcome.</small></span></div>
            <div className="proof-row"><LockKeyhole size={18} /><span><strong>Immutable rule</strong><small>Oracle URL, JSON path, target and comparator are fixed at creation.</small></span></div>
          </div>
        </div>
      </section>

      <section className="runtime-card" aria-label="Runtime connection">
        <div className="runtime-status">
          <Network size={18} />
          <div><strong>Runtime connection</strong><p>{networkReason}</p></div>
        </div>
        <div className="connection-fields">
          <label>RPC URL<input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} spellCheck={false} /></label>
          <label>RitualPredict address<input value={contractInput} onChange={(e) => setContractInput(e.target.value)} placeholder="0x…" spellCheck={false} /></label>
          <button className="button secondary apply-button" onClick={applyConnection}>Apply</button>
          <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh chain data" title="Refresh chain data"><RefreshCw size={17} className={loading ? "spin" : ""} /></button>
        </div>
      </section>

      {notice && (
        <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live="polite">
          {notice.tone === "pending" ? <LoaderCircle className="spin" size={18} /> : notice.tone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      <section className="metrics-grid" aria-label="Market overview">
        <Metric icon={<Layers3 />} label="Markets shown" value={String(displayedMarkets.length)} meta={live ? "On-chain" : "Preview dataset"} />
        <Metric icon={<Activity />} label="Active markets" value={String(activeMarkets)} meta="Open, closed or resolving" />
        <Metric icon={<CircleDollarSign />} label="Visible pool" value={formatRitual(totalPool)} meta="Across markets shown" />
        <Metric icon={<Gauge />} label="Execution balance" value={live ? formatRitual(executionBalance) : "—"} meta={blockNumber ? `Block ${blockNumber}` : "Requires live contract"} />
      </section>

      <section className="section-block" id="markets">
        <div className="section-heading">
          <div><span className="section-kicker">Market board</span><h2>Resolution state at a glance</h2></div>
          {!live && <div className="preview-note"><AlertTriangle size={16} /> Preview data is illustrative, not chain state.</div>}
        </div>
        <div className="market-grid">
          {displayedMarkets.map((market) => {
            const pool = market.totalYes + market.totalNo;
            const yesPct = pool === 0n ? 50 : Number((market.totalYes * 10_000n) / pool) / 100;
            const canBet = live && account && market.state === 0 && blockNumber !== null && blockNumber < market.closeBlock;
            const canClaim = live && account && market.stake && market.stake.claimable > 0n && !market.stake.settled;
            const canRescue = live && account && market.rescueBlock && blockNumber !== null && blockNumber > market.rescueBlock && market.state < 3;
            return (
              <article className="market-card" key={market.id.toString()}>
                <div className="market-card-top">
                  <span className="market-id">MARKET #{market.id.toString()}</span>
                  <span className={`state-badge ${stateTone(market.state)}`}>{MARKET_STATE[market.state] ?? "Unknown"}</span>
                </div>
                <h3>{market.question}</h3>
                <div className="rule-line"><Target size={15} /><span>Resolve YES when observed <strong>{COMPARATOR[market.comparator]} {market.target.toString()}</strong></span></div>

                <div className="pool-bar" aria-label={`YES ${yesPct.toFixed(1)} percent, NO ${(100 - yesPct).toFixed(1)} percent`}>
                  <div className="yes-fill" style={{ width: `${yesPct}%` }} />
                </div>
                <div className="pool-labels"><span><i className="dot yes" /> YES {yesPct.toFixed(1)}%</span><span>NO {(100 - yesPct).toFixed(1)}% <i className="dot no" /></span></div>

                <div className="market-stats">
                  <div><small>Total pool</small><strong>{formatRitual(pool)}</strong></div>
                  <div><small>Attempts</small><strong>{market.attempts} / 3</strong></div>
                  <div><small>Schedule</small><strong>#{market.scheduleId.toString()}</strong></div>
                </div>

                {market.state === 3 && <div className="resolution-result"><CheckCircle2 size={17} /><span>Resolved <strong>{OUTCOME[market.outcome]}</strong> at observed value <strong>{market.observedValue.toString()}</strong></span></div>}
                {market.state === 4 && <div className="resolution-result invalid"><AlertTriangle size={17} /><span>Invalid: {market.invalidReason || "Refunds enabled"}</span></div>}

                <div className="oracle-line"><Code2 size={14} /><span title={market.oracleUrl}>{market.oracleUrl.replace(/^https?:\/\//, "").slice(0, 32)}{market.oracleUrl.length > 40 ? "…" : ""}</span><span>{market.jsonPath}</span></div>

                <div className="market-actions">
                  <div className="bet-entry">
                    <label htmlFor={`bet-${market.id}`}>Stake</label>
                    <div><input id={`bet-${market.id}`} inputMode="decimal" value={betAmounts[market.id.toString()] ?? "0.1"} onChange={(e) => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: e.target.value }))} disabled={!canBet} /><span>RITUAL</span></div>
                  </div>
                  <div className="bet-buttons">
                    <button className="button bet-yes" disabled={!canBet} onClick={() => runTransaction("YES bet", { functionName: "bet", args: [market.id, true], value: parseEther(betAmounts[market.id.toString()] ?? "0.1") })}>YES</button>
                    <button className="button bet-no" disabled={!canBet} onClick={() => runTransaction("NO bet", { functionName: "bet", args: [market.id, false], value: parseEther(betAmounts[market.id.toString()] ?? "0.1") })}>NO</button>
                  </div>
                  {canClaim && <button className="button secondary full" onClick={() => runTransaction(market.state === 4 ? "Claim refund" : "Claim winnings", { functionName: market.state === 4 ? "claimRefund" : "claimWinnings", args: [market.id] })}>{market.state === 4 ? "Claim refund" : `Claim ${formatRitual(market.stake!.claimable)}`}</button>}
                  {canRescue && <button className="button rescue full" onClick={() => runTransaction("Rescue expired market", { functionName: "rescueExpiredMarket", args: [market.id] })}><ShieldCheck size={16} /> Rescue & unlock refunds</button>}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="engine-section" id="resolution-engine">
        <div className="section-heading"><div><span className="section-kicker">Ritual-native flow</span><h2>The resolution engine</h2></div></div>
        <div className="engine-flow">
          <EngineStep number="01" icon={<Clock3 />} title="Scheduler wakes" copy="createMarket books 3 executions up front. No off-chain keeper is required." />
          <EngineStep number="02" icon={<ShieldCheck />} title="TEE executor selected" copy="The registry picks a live HTTP-capable executor for each attempt." />
          <EngineStep number="03" icon={<ExternalLink />} title="HTTP + JQ" copy="A TEE fetches the public oracle. JQ extracts one uint256 from the response." />
          <EngineStep number="04" icon={<CheckCircle2 />} title="Settle or refund" copy="YES/NO resolves pari-mutuel payouts. Exhausted retries or rescue produce refunds." />
        </div>
      </section>

      <footer><span>Built for Ritual Bootcamp 2 · Proof of Building</span><a href="https://github.com/duclucky/ritual-chain-workshop-2" target="_blank" rel="noreferrer">View fork <ExternalLink size={14} /></a></footer>

      {showCreate && (
        <CreateMarketDialog
          onClose={() => setShowCreate(false)}
          onSubmit={async (params) => {
            await runTransaction("Create market", { functionName: "createMarket", args: [params] });
            setShowCreate(false);
          }}
        />
      )}
    </main>
  );
}

function Metric({ icon, label, value, meta }: { icon: React.ReactNode; label: string; value: string; meta: string }) {
  return <div className="metric-card"><div className="metric-icon">{icon}</div><div><small>{label}</small><strong>{value}</strong><span>{meta}</span></div></div>;
}

function EngineStep({ number, icon, title, copy }: { number: string; icon: React.ReactNode; title: string; copy: string }) {
  return <article className="engine-step"><div className="engine-number">{number}</div><div className="engine-icon">{icon}</div><h3>{title}</h3><p>{copy}</p></article>;
}

function CreateMarketDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (params: any) => Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({ question: "", oracleUrl: "", jsonPath: ".price", target: "4000", comparator: "1", bettingSeconds: "300", resolveDelaySeconds: "60" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const first = formRef.current?.querySelector<HTMLElement>("input, select, button");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function update(key: string, value: string) { setForm((prev) => ({ ...prev, [key]: value })); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (form.question.trim().length < 8) next.question = "Write a clear market question (at least 8 characters).";
    if (!/^https?:\/\//.test(form.oracleUrl)) next.oracleUrl = "Use a public HTTP(S) oracle URL reachable by the Ritual TEE executor.";
    if (!form.jsonPath.trim()) next.jsonPath = "JSON path is required.";
    if (!/^\d+$/.test(form.target)) next.target = "Target must be an unsigned integer.";
    if (Number(form.bettingSeconds) < 30) next.bettingSeconds = "Betting window must be at least 30 seconds.";
    if (Number(form.resolveDelaySeconds) < 15) next.resolveDelaySeconds = "Resolve delay must be at least 15 seconds.";
    setErrors(next);
    if (Object.keys(next).length) {
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    await onSubmit({
      question: form.question.trim(),
      oracleUrl: form.oracleUrl.trim(),
      jsonPath: form.jsonPath.trim(),
      target: BigInt(form.target),
      comparator: Number(form.comparator),
      bettingSeconds: BigInt(form.bettingSeconds),
      resolveDelaySeconds: BigInt(form.resolveDelaySeconds),
    });
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="dialog-heading"><div><span className="section-kicker">Immutable at creation</span><h2 id="create-title">Create a self-resolving market</h2></div><button className="icon-button" onClick={onClose} aria-label="Close create market dialog">×</button></div>
        <form ref={formRef} onSubmit={submit} noValidate>
          <Field label="Question" error={errors.question}><input value={form.question} onChange={(e) => update("question", e.target.value)} placeholder="Will ETH/USD be at least $4,000?" /></Field>
          <Field label="Public oracle URL" error={errors.oracleUrl}><input value={form.oracleUrl} onChange={(e) => update("oracleUrl", e.target.value)} placeholder="https://api.example.com/eth" /></Field>
          <div className="form-grid two"><Field label="JSON path" error={errors.jsonPath}><input value={form.jsonPath} onChange={(e) => update("jsonPath", e.target.value)} /></Field><Field label="Target" error={errors.target}><input inputMode="numeric" value={form.target} onChange={(e) => update("target", e.target.value)} /></Field></div>
          <div className="form-grid three"><Field label="Comparator"><select value={form.comparator} onChange={(e) => update("comparator", e.target.value)}><option value="0">Greater than</option><option value="1">Greater or equal</option><option value="2">Less than</option><option value="3">Less or equal</option></select></Field><Field label="Betting seconds" error={errors.bettingSeconds}><input inputMode="numeric" value={form.bettingSeconds} onChange={(e) => update("bettingSeconds", e.target.value)} /></Field><Field label="Resolve delay" error={errors.resolveDelaySeconds}><input inputMode="numeric" value={form.resolveDelaySeconds} onChange={(e) => update("resolveDelaySeconds", e.target.value)} /></Field></div>
          <div className="dialog-note"><LockKeyhole size={16} /><span>The oracle URL, JSON path, target, comparator and resolution blocks cannot be changed after creation.</span></div>
          <div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" type="submit"><Plus size={16} /> Create & schedule</button></div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const control = cloneElement(children, { id, "aria-describedby": error ? `${id}-error` : undefined, "aria-invalid": Boolean(error) } as Record<string, unknown>);
  return <label className="field" htmlFor={id}><span>{label}</span>{control}{error && <small className="field-error" id={`${id}-error`}>{error}</small>}</label>
}

export default App;

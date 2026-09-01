import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  Flame,
  Gauge,
  HelpCircle,
  Info,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  TrendingUp,
  Wallet,
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
const RITUAL_WALLET_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
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
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatRitual(value: bigint) {
  const n = Number(formatEther(value));
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} RITUAL`;
}

function stateTone(state: number) {
  if (state === 3) return "success";
  if (state === 4) return "danger";
  if (state === 2) return "warning";
  if (state === 1) return "muted";
  return "active";
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
  const [networkReason, setNetworkReason] = useState("Checking Ritual RPC...");
  const [account, setAccount] = useState<Address | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [betAmounts, setBetAmounts] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [filterState, setFilterState] = useState<"all" | "open" | "resolving" | "resolved" | "invalid">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

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
      await publicClient.readContract({
        address: RITUAL_WALLET,
        abi: RITUAL_WALLET_ABI,
        functionName: "balanceOf",
        args: [RITUAL_WALLET],
      });

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
          return {
            ...m,
            attempts: Number(m.attempts),
            state: Number(m.state),
            outcome: Number(m.outcome),
            comparator: Number(m.comparator),
            stake,
            rescueBlock,
          };
        }),
      );

      setMarkets(normalized);
      setBlockNumber(latestBlock);
      setExecutionBalance(fees as bigint);
      setLive(true);
      setNetworkReason(`Verified Ritual chain & contract at ${shortAddress(contractAddress)}`);
    } catch (error) {
      setLive(false);
      setMarkets([]);
      const raw = error instanceof Error ? error.message : "RPC unavailable.";
      const friendly = /failed to fetch|http request failed|timeout|network/i.test(raw)
        ? `RPC unavailable at ${rpcUrl}. Connect local Hardhat node or check network.`
        : raw.split("\n")[0];
      setNetworkReason(friendly);
    } finally {
      setLoading(false);
    }
  }, [account, contractAddress, publicClient, rpcUrl]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice({ tone: "error", text: "No injected wallet found. Please install a Web3 wallet (e.g. MetaMask)." });
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainIdHex, 16);
      if (chainId !== RITUAL_CHAIN_ID) {
        throw new Error(`Wallet is on chain ID ${chainId}. Please switch to Ritual Chain (ID ${RITUAL_CHAIN_ID}).`);
      }
      setAccount(accounts[0] ?? null);
      setNotice({ tone: "success", text: `Wallet connected: ${shortAddress(accounts[0])}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Wallet connection failed." });
    }
  }

  async function runTransaction(
    label: string,
    request: { functionName: string; args?: readonly unknown[]; value?: bigint },
  ) {
    if (!window.ethereum || !account || !contractAddress || !live) {
      setNotice({ tone: "error", text: "Please connect your wallet and verify the live contract first." });
      return;
    }
    setNotice({ tone: "pending", text: `${label}: Waiting for wallet approval...` });
    try {
      const walletClient = createWalletClient({ account, chain: ritualChain, transport: custom(window.ethereum) });
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: ritualPredictAbi,
        functionName: request.functionName as any,
        args: request.args as any,
        value: request.value,
      } as any);
      setNotice({ tone: "pending", text: `${label} broadcasted (${shortAddress(hash)}). Awaiting confirmation...` });
      await publicClient.waitForTransactionReceipt({ hash });
      setNotice({ tone: "success", text: `${label}: Confirmed on-chain successfully!` });
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
    setNotice({ tone: "pending", text: "Connection settings updated. Verifying RPC and contract..." });
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(null), 2000);
  }

  const displayedMarkets = live && markets.length ? markets : previewMarkets;
  const totalPool = displayedMarkets.reduce((sum, market) => sum + market.totalYes + market.totalNo, 0n);
  const activeMarkets = displayedMarkets.filter((m) => m.state === 0 || m.state === 1 || m.state === 2).length;

  const filteredMarkets = useMemo(() => {
    return displayedMarkets.filter((m) => {
      const matchesSearch =
        searchQuery.trim() === "" ||
        m.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.id.toString() === searchQuery.trim();

      if (!matchesSearch) return false;
      if (filterState === "all") return true;
      if (filterState === "open") return m.state === 0;
      if (filterState === "resolving") return m.state === 1 || m.state === 2;
      if (filterState === "resolved") return m.state === 3;
      if (filterState === "invalid") return m.state === 4;
      return true;
    });
  }, [displayedMarkets, filterState, searchQuery]);

  return (
    <div className="app-layout">
      <a className="skip-link" href="#markets">Skip to markets</a>

      {/* Floating Background Effects */}
      <div className="ambient-glow glow-top-left" />
      <div className="ambient-glow glow-bottom-right" />
      <div className="mesh-grid-pattern" />

      {/* Header */}
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#top" aria-label="Ritual Predict Home">
            <div className="brand-badge">
              <Zap size={20} className="brand-icon" />
              <div className="brand-pulse" />
            </div>
            <div className="brand-text">
              <span className="brand-title">Ritual Predict</span>
              <span className="brand-subtitle">Autonomous Prediction Markets</span>
            </div>
          </a>

          <div className="topbar-right">
            <button
              className="hud-toggle-btn"
              onClick={() => setShowConfig(!showConfig)}
              title="Connection Console"
            >
              <Settings2 size={16} />
              <span className="hud-label">Console</span>
            </button>

            <div className={`status-pill ${live ? "status-live" : "status-preview"}`}>
              <span className="status-dot" />
              <span>{live ? "Live Chain (1979)" : "Preview Mode"}</span>
            </div>

            <button className="button wallet-button" onClick={connectWallet}>
              <Wallet size={16} />
              <span>{account ? shortAddress(account) : "Connect Wallet"}</span>
            </button>
          </div>
        </div>

        {/* Expandable Connection HUD Drawer */}
        {showConfig && (
          <div className="connection-drawer">
            <div className="connection-drawer-inner">
              <div className="drawer-header">
                <div className="drawer-title">
                  <Terminal size={16} />
                  <span>Ritual Protocol Node Configuration</span>
                </div>
                <button className="drawer-close" onClick={() => setShowConfig(false)}>x</button>
              </div>

              <div className="drawer-status-line">
                <Network size={15} />
                <span>{networkReason}</span>
              </div>

              <div className="drawer-grid">
                <div className="drawer-field">
                  <label htmlFor="rpc-input">RPC Endpoint</label>
                  <input
                    id="rpc-input"
                    value={rpcUrl}
                    onChange={(e) => setRpcUrl(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="drawer-field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label htmlFor="contract-input">RitualPredict Contract</label>
                    {contractAddress && (
                      <button
                        type="button"
                        onClick={() => copyText(contractAddress, "contract")}
                        style={{ fontSize: "11px", color: "var(--accent-emerald)", display: "flex", alignItems: "center", gap: "4px" }}
                      >
                        {copiedLabel === "contract" ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedLabel === "contract" ? "Copied" : "Copy"}</span>
                      </button>
                    )}
                  </div>
                  <input
                    id="contract-input"
                    value={contractInput}
                    onChange={(e) => setContractInput(e.target.value)}
                    placeholder="0x..."
                    spellCheck={false}
                  />
                </div>
                <div className="drawer-actions">
                  <button className="button primary-action-btn" onClick={applyConnection}>
                    Apply Settings
                  </button>
                  <button
                    className="icon-refresh-btn"
                    onClick={() => void refresh()}
                    aria-label="Refresh telemetry"
                  >
                    <RefreshCw size={16} className={loading ? "spin" : ""} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className="app-container">
        {/* Hero Section */}
        <section className="hero-section" id="top">
          <div className="hero-badge-pill">
            <Sparkles size={14} />
            <span>Zero Off-Chain Keepers - Native TEE Automation</span>
          </div>

          <div className="hero-main-row">
            <div className="hero-text-block">
              <h1 className="hero-title">
                Markets that wake up, <br />
                <span className="text-gradient">resolve via TEE</span>, and settle themselves.
              </h1>
              <p className="hero-description">
                Built natively on Ritual Chain. The Ritual Scheduler activates the contract at predetermined blocks.
                TEE executors fetch oracle data via HTTP precompiles, parse numbers with JQ, and resolve pari-mutuel payouts autonomously.
              </p>

              <div className="hero-cta-group">
                <button
                  className="button hero-primary-btn"
                  onClick={() => setShowCreate(true)}
                  disabled={!live}
                >
                  <Plus size={18} />
                  <span>Create Market</span>
                </button>
                <a className="button hero-secondary-btn" href="#markets">
                  <span>Explore Markets</span>
                  <ArrowRight size={16} />
                </a>
                <a className="hero-ghost-link" href="#resolution-engine">
                  <span>How Resolution Works</span>
                  <ChevronRight size={14} />
                </a>
              </div>
            </div>

            {/* Hero Interactive Pillars */}
            <div className="hero-pillars">
              <div className="pillar-card">
                <div className="pillar-icon-box cyan">
                  <ShieldCheck size={20} />
                </div>
                <div className="pillar-content">
                  <h4>Permissionless Rescue</h4>
                  <p>Stuck markets can be safely unlocked and refunded once the Scheduler expiry deadline passes.</p>
                </div>
              </div>

              <div className="pillar-card">
                <div className="pillar-icon-box emerald">
                  <RotateCcw size={20} />
                </div>
                <div className="pillar-content">
                  <h4>3-Attempt Scheduled Retries</h4>
                  <p>Transient oracle glitches never cause false NO outcomes. Retries roll fresh TEE executor seeds.</p>
                </div>
              </div>

              <div className="pillar-card">
                <div className="pillar-icon-box purple">
                  <LockKeyhole size={20} />
                </div>
                <div className="pillar-content">
                  <h4>Immutable Resolution Rules</h4>
                  <p>Target, comparator, JQ expression, and oracle endpoints are cryptographically locked at inception.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Global Telemetry Metrics */}
        <section className="telemetry-bar" aria-label="Ritual Chain Telemetry">
          <div className="telemetry-item">
            <div className="telemetry-icon emerald">
              <Layers3 size={18} />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-label">Active / Total Markets</span>
              <span className="telemetry-value">{activeMarkets} / {displayedMarkets.length}</span>
              <span className="telemetry-sub">{live ? "On-Chain Live" : "Preview Fixtures"}</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-icon cyan">
              <CircleDollarSign size={18} />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-label">Total Staked Volume</span>
              <span className="telemetry-value">{formatRitual(totalPool)}</span>
              <span className="telemetry-sub">Pari-mutuel Pools</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-icon purple">
              <Gauge size={18} />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-label">Scheduler Gas Treasury</span>
              <span className="telemetry-value">{live ? formatRitual(executionBalance) : "0.5000 RITUAL"}</span>
              <span className="telemetry-sub">Prepaid Execution Balance</span>
            </div>
          </div>

          <div className="telemetry-item">
            <div className="telemetry-icon amber">
              <Clock3 size={18} />
            </div>
            <div className="telemetry-data">
              <span className="telemetry-label">Ritual Block Height</span>
              <span className="telemetry-value">{blockNumber ? `#${blockNumber.toString()}` : "Syncing..."}</span>
              <span className="telemetry-sub">~195ms Block Time</span>
            </div>
          </div>
        </section>

        {/* Market Board Section */}
        <section className="markets-section" id="markets">
          <div className="markets-header">
            <div className="markets-title-group">
              <div className="section-eyebrow">
                <Flame size={14} />
                <span>Prediction Terminal</span>
              </div>
              <h2 className="section-main-title">Active Market Board</h2>
            </div>

            {/* Filter & Search Bar */}
            <div className="markets-controls">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search question or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="search-clear" onClick={() => setSearchQuery("")}>x</button>
                )}
              </div>

              <div className="filter-pill-group">
                {(
                  [
                    { key: "all", label: "All" },
                    { key: "open", label: "Open" },
                    { key: "resolving", label: "Resolving" },
                    { key: "resolved", label: "Resolved" },
                    { key: "invalid", label: "Invalid" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    className={`filter-btn ${filterState === tab.key ? "active" : ""}`}
                    onClick={() => setFilterState(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!live && (
            <div className="preview-banner">
              <Info size={18} />
              <div>
                <strong>Preview Mode Active</strong>
                <p>Showing sample markets. Connect to a live Ritual node to execute real on-chain stakes and settlements.</p>
              </div>
            </div>
          )}

          {/* Market Cards Grid */}
          <div className="market-cards-grid">
            {filteredMarkets.length === 0 ? (
              <div className="empty-market-state">
                <HelpCircle size={40} />
                <h3>No markets match your filter</h3>
                <p>Try resetting the search keyword or switching filter tabs.</p>
                <button className="button hero-secondary-btn" onClick={() => { setFilterState("all"); setSearchQuery(""); }}>
                  Reset Filters
                </button>
              </div>
            ) : (
              filteredMarkets.map((market) => {
                const pool = market.totalYes + market.totalNo;
                const yesPct = pool === 0n ? 50 : Number((market.totalYes * 10_000n) / pool) / 100;
                const noPct = 100 - yesPct;
                const canBet = live && account && market.state === 0 && blockNumber !== null && blockNumber < market.closeBlock;
                const canClaim = live && account && market.stake && market.stake.claimable > 0n && !market.stake.settled;
                const canRescue = live && account && market.rescueBlock && blockNumber !== null && blockNumber > market.rescueBlock && market.state < 3;
                const isResolved = market.state === 3;
                const isInvalid = market.state === 4;
                const currentBet = betAmounts[market.id.toString()] ?? "0.1";

                return (
                  <article className={`market-card ${stateTone(market.state)}`} key={market.id.toString()}>
                    <div className="card-top-row">
                      <div className="card-id-tag">
                        <span className="hash-symbol">#</span>
                        <span>MARKET-{market.id.toString()}</span>
                      </div>
                      <div className={`badge-state ${stateTone(market.state)}`}>
                        <span className="dot-indicator" />
                        <span>{MARKET_STATE[market.state] ?? "Unknown"}</span>
                      </div>
                    </div>

                    <h3 className="card-question">{market.question}</h3>

                    {/* Condition Box */}
                    <div className="condition-box">
                      <Target size={15} className="condition-icon" />
                      <div className="condition-text">
                        <span className="condition-lead">Resolves YES if:</span>
                        <code className="condition-code">
                          Observed Value {COMPARATOR[market.comparator]} {market.target.toString()}
                        </code>
                      </div>
                    </div>

                    {/* Visual Odds / Ratio Gauge */}
                    <div className="odds-gauge-container">
                      <div className="odds-gauge-bar">
                        <div className="odds-fill-yes" style={{ width: `${yesPct}%` }} />
                        <div className="odds-fill-no" style={{ width: `${noPct}%` }} />
                      </div>
                      <div className="odds-labels-row">
                        <div className="odds-item yes">
                          <span className="legend-dot yes" />
                          <span className="odds-name">YES</span>
                          <span className="odds-percent">{yesPct.toFixed(1)}%</span>
                          <span className="odds-amount">({formatRitual(market.totalYes)})</span>
                        </div>
                        <div className="odds-item no">
                          <span className="odds-amount">({formatRitual(market.totalNo)})</span>
                          <span className="odds-percent">{noPct.toFixed(1)}%</span>
                          <span className="odds-name">NO</span>
                          <span className="legend-dot no" />
                        </div>
                      </div>
                    </div>

                    {/* Metadata Strip */}
                    <div className="card-meta-grid">
                      <div className="meta-cell">
                        <span className="meta-cell-label">Total Pool</span>
                        <strong className="meta-cell-value">{formatRitual(pool)}</strong>
                      </div>
                      <div className="meta-cell">
                        <span className="meta-cell-label">Scheduler Retries</span>
                        <strong className="meta-cell-value">{market.attempts} / 3</strong>
                      </div>
                      <div className="meta-cell">
                        <span className="meta-cell-label">Schedule ID</span>
                        <strong className="meta-cell-value">#{market.scheduleId.toString()}</strong>
                      </div>
                    </div>

                    {/* Settlement / Outcome Banner */}
                    {isResolved && (
                      <div className="outcome-banner success">
                        <CheckCircle2 size={18} />
                        <div>
                          <strong>Outcome: {OUTCOME[market.outcome]}</strong>
                          <span>Observed Oracle Value: {market.observedValue.toString()}</span>
                        </div>
                      </div>
                    )}

                    {isInvalid && (
                      <div className="outcome-banner invalid">
                        <AlertTriangle size={18} />
                        <div>
                          <strong>Market Invalidated</strong>
                          <span>{market.invalidReason || "All participants eligible for full stake refund"}</span>
                        </div>
                      </div>
                    )}

                    {/* Oracle Specification Snippet */}
                    <div className="oracle-snippet">
                      <div className="oracle-path">
                        <Code2 size={13} />
                        <span className="url-text" title={market.oracleUrl}>
                          {market.oracleUrl.replace(/^https?:\/\//, "")}
                        </span>
                      </div>
                      <span className="jq-tag">JQ: {market.jsonPath}</span>
                    </div>

                    {/* User Stake Info if Connected */}
                    {market.stake && (market.stake.yes > 0n || market.stake.no > 0n) && (
                      <div className="user-stake-box">
                        <span className="stake-title">Your Stakes:</span>
                        <span className="stake-badge yes">YES: {formatRitual(market.stake.yes)}</span>
                        <span className="stake-badge no">NO: {formatRitual(market.stake.no)}</span>
                      </div>
                    )}

                    {/* Staking & Action Controls */}
                    <div className="card-actions-wrapper">
                      <div className="stake-input-module">
                        <div className="stake-input-header">
                          <label htmlFor={`bet-${market.id}`}>Stake Amount</label>
                          <div className="quick-presets">
                            {["0.1", "0.5", "1.0", "5.0"].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                className="preset-btn"
                                onClick={() => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: preset }))}
                                disabled={!canBet}
                              >
                                +{preset}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="stake-input-field">
                          <input
                            id={`bet-${market.id}`}
                            inputMode="decimal"
                            value={currentBet}
                            onChange={(e) => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: e.target.value }))}
                            disabled={!canBet}
                            placeholder="0.1"
                          />
                          <span className="currency-tag">RITUAL</span>
                        </div>
                      </div>

                      <div className="binary-bet-buttons">
                        <button
                          className="bet-action-btn yes-btn"
                          disabled={!canBet}
                          onClick={() =>
                            runTransaction("YES Stake", {
                              functionName: "bet",
                              args: [market.id, true],
                              value: parseEther(currentBet),
                            })
                          }
                        >
                          <TrendingUp size={16} />
                          <span>Stake YES</span>
                        </button>

                        <button
                          className="bet-action-btn no-btn"
                          disabled={!canBet}
                          onClick={() =>
                            runTransaction("NO Stake", {
                              functionName: "bet",
                              args: [market.id, false],
                              value: parseEther(currentBet),
                            })
                          }
                        >
                          <ArrowRight size={16} />
                          <span>Stake NO</span>
                        </button>
                      </div>

                      {canClaim && (
                        <button
                          className="button claim-reward-btn full"
                          onClick={() =>
                            runTransaction(isInvalid ? "Claim Full Refund" : "Claim Settlement Winnings", {
                              functionName: isInvalid ? "claimRefund" : "claimWinnings",
                              args: [market.id],
                            })
                          }
                        >
                          <Sparkles size={16} />
                          <span>{isInvalid ? "Claim Full Refund" : `Claim ${formatRitual(market.stake!.claimable)}`}</span>
                        </button>
                      )}

                      {canRescue && (
                        <button
                          className="button rescue-action-btn full"
                          onClick={() =>
                            runTransaction("Rescue Expired Market", {
                              functionName: "rescueExpiredMarket",
                              args: [market.id],
                            })
                          }
                        >
                          <ShieldAlert size={16} />
                          <span>Activate Safety Rescue & Unlock Refunds</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        {/* Resolution Engine Architecture Breakdown */}
        <section className="engine-section" id="resolution-engine">
          <div className="engine-header">
            <div className="section-eyebrow">
              <Zap size={14} />
              <span>Ritual-Native Execution Topology</span>
            </div>
            <h2 className="section-main-title">How Self-Resolving Execution Works</h2>
            <p className="section-subtitle">
              Every market is autonomous: creation books future execution blocks with Ritual Scheduler, and TEE workers securely resolve the outcome without human or bot intervention.
            </p>
          </div>

          <div className="engine-grid">
            <div className="engine-card">
              <div className="engine-step-badge">STAGE 01</div>
              <div className="engine-icon-box emerald">
                <Clock3 size={24} />
              </div>
              <h3 className="engine-card-title">Scheduler Wake-up</h3>
              <p className="engine-card-desc">
                When created, the market books 3 scheduled executions with the Ritual Scheduler contract. No off-chain bot or keeper infrastructure is needed.
              </p>
            </div>

            <div className="engine-card">
              <div className="engine-step-badge">STAGE 02</div>
              <div className="engine-icon-box cyan">
                <ShieldCheck size={24} />
              </div>
              <h3 className="engine-card-title">TEE Executor Selection</h3>
              <p className="engine-card-desc">
                The on-chain TEEServiceRegistry selects an active, verifiable HTTP-capable executor for each attempt using randomized seeds.
              </p>
            </div>

            <div className="engine-card">
              <div className="engine-step-badge">STAGE 03</div>
              <div className="engine-icon-box purple">
                <Code2 size={24} />
              </div>
              <h3 className="engine-card-title">HTTP & JQ Precompiles</h3>
              <p className="engine-card-desc">
                The executor calls the HTTP precompile (0x0801) to fetch public API data, and the JQ precompile (0x0803) parses the target uint256 value.
              </p>
            </div>

            <div className="engine-card">
              <div className="engine-step-badge">STAGE 04</div>
              <div className="engine-icon-box amber">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="engine-card-title">Settlement or Rescue</h3>
              <p className="engine-card-desc">
                The observed value determines YES or NO settlement. If 3 attempts fail or execution is stalled, the market unlocks full stakeholder refunds.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Toast Notification HUD */}
      {notice && (
        <div className={`toast-notification ${notice.tone}`} role="alert" aria-live="polite">
          <div className="toast-icon">
            {notice.tone === "pending" ? (
              <LoaderCircle className="spin" size={20} />
            ) : notice.tone === "success" ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
          </div>
          <div className="toast-content">
            <span className="toast-title">
              {notice.tone === "pending" ? "Transaction Pending" : notice.tone === "success" ? "Success" : "Error"}
            </span>
            <p className="toast-text">{notice.text}</p>
          </div>
          <button className="toast-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss notification">
            x
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="footer-bar">
        <div className="footer-inner">
          <div className="footer-left">
            <div className="footer-logo">
              <Zap size={16} />
              <strong>Ritual Predict</strong>
            </div>
            <span className="footer-copy">Built for Ritual Chain Workshop 2 - Proof of Building</span>
          </div>
          <div className="footer-right">
            <a
              href="https://github.com/duclucky/ritual-chain-workshop-2"
              target="_blank"
              rel="noreferrer"
              className="footer-link"
            >
              <span>GitHub Repository</span>
              <ExternalLink size={14} />
            </a>
            <a
              href="https://docs.ritualfoundation.org"
              target="_blank"
              rel="noreferrer"
              className="footer-link"
            >
              <span>Ritual Docs</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </footer>

      {/* Create Market Modal */}
      {showCreate && (
        <CreateMarketDialog
          onClose={() => setShowCreate(false)}
          onSubmit={async (params) => {
            await runTransaction("Create Market", { functionName: "createMarket", args: [params] });
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function CreateMarketDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (params: any) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({
    question: "",
    oracleUrl: "",
    jsonPath: ".price",
    target: "4000",
    comparator: "1",
    bettingSeconds: "300",
    resolveDelaySeconds: "60",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const first = formRef.current?.querySelector<HTMLElement>("input, select, button");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

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
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="dialog-header">
          <div className="dialog-title-group">
            <span className="dialog-kicker">Immutable On-Chain Rule</span>
            <h2 id="create-title">Create Autonomous Market</h2>
          </div>
          <button className="dialog-close-btn" onClick={onClose} aria-label="Close dialog">
            x
          </button>
        </div>

        <form ref={formRef} onSubmit={submit} noValidate className="dialog-form">
          <Field label="Market Question" error={errors.question}>
            <input
              value={form.question}
              onChange={(e) => update("question", e.target.value)}
              placeholder="e.g. Will ETH/USD be at least $4,000?"
            />
          </Field>

          <Field label="Public Oracle Endpoint (HTTPS)" error={errors.oracleUrl}>
            <input
              value={form.oracleUrl}
              onChange={(e) => update("oracleUrl", e.target.value)}
              placeholder="https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT"
            />
          </Field>

          <div className="form-row-two">
            <Field label="JSON Path Expression" error={errors.jsonPath}>
              <input value={form.jsonPath} onChange={(e) => update("jsonPath", e.target.value)} placeholder=".price" />
            </Field>
            <Field label="Target Threshold (uint256)" error={errors.target}>
              <input
                inputMode="numeric"
                value={form.target}
                onChange={(e) => update("target", e.target.value)}
                placeholder="4000"
              />
            </Field>
          </div>

          <div className="form-row-three">
            <Field label="Comparator Condition">
              <select value={form.comparator} onChange={(e) => update("comparator", e.target.value)}>
                <option value="0">Greater than (&gt;)</option>
                <option value="1">Greater or equal (≥)</option>
                <option value="2">Less than (&lt;)</option>
                <option value="3">Less or equal (≤)</option>
              </select>
            </Field>
            <Field label="Betting Duration (seconds)" error={errors.bettingSeconds}>
              <input
                inputMode="numeric"
                value={form.bettingSeconds}
                onChange={(e) => update("bettingSeconds", e.target.value)}
                placeholder="300"
              />
            </Field>
            <Field label="Resolution Delay (seconds)" error={errors.resolveDelaySeconds}>
              <input
                inputMode="numeric"
                value={form.resolveDelaySeconds}
                onChange={(e) => update("resolveDelaySeconds", e.target.value)}
                placeholder="60"
              />
            </Field>
          </div>

          <div className="dialog-immutable-warning">
            <LockKeyhole size={18} />
            <span>
              All resolution parameters (oracle URL, JSON path, target condition, schedule delays) are immutable once submitted on-chain.
            </span>
          </div>

          <div className="dialog-footer-actions">
            <button type="button" className="button dialog-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="button dialog-submit-btn" type="submit">
              <Plus size={16} />
              <span>Deploy & Schedule Market</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const control = cloneElement(children, {
    id,
    "aria-describedby": error ? `${id}-error` : undefined,
    "aria-invalid": Boolean(error),
  } as Record<string, unknown>);
  return (
    <div className="form-field-group">
      <label htmlFor={id} className="field-label">
        <span>{label}</span>
      </label>
      {control}
      {error && (
        <small className="field-error-msg" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

export default App;

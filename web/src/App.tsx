import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
    oracleUrl: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
    jsonPath: ".price",
    target: 4000n,
    comparator: 1,
    closeBlock: 125840n,
    resolveBlock: 125910n,
    scheduleId: 12n,
    totalYes: parseEther("14.5"),
    totalNo: parseEther("6.2"),
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
    question: "Will BTC stay above $110,000 at resolution block?",
    oracleUrl: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
    jsonPath: ".price",
    target: 110000n,
    comparator: 1,
    closeBlock: 125100n,
    resolveBlock: 125180n,
    scheduleId: 11n,
    totalYes: parseEther("22.0"),
    totalNo: parseEther("18.4"),
    state: 3,
    outcome: 1,
    attempts: 1,
    observedValue: 112420n,
    invalidReason: "",
    preview: true,
  },
  {
    id: 1n,
    creator: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    question: "Will Ritual Mainnet TPS exceed 2,500 operations/sec?",
    oracleUrl: "https://telemetry.ritualfoundation.org/metrics",
    jsonPath: ".peak_tps",
    target: 2500n,
    comparator: 0,
    closeBlock: 124000n,
    resolveBlock: 124080n,
    scheduleId: 8n,
    totalYes: parseEther("8.8"),
    totalNo: parseEther("1.2"),
    state: 3,
    outcome: 1,
    attempts: 1,
    observedValue: 2840n,
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
  if (state === 1) return "resolving";
  return "open";
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
  const [expandedOracle, setExpandedOracle] = useState<Record<string, boolean>>({});

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
        setNetworkReason("Ritual RPC connected. Enter a RitualPredict address to load markets.");
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
      setNetworkReason(`Verified Ritual Chain & RitualPredict at ${shortAddress(contractAddress)}`);
    } catch (error) {
      setLive(false);
      setMarkets([]);
      const raw = error instanceof Error ? error.message : "RPC unavailable.";
      const friendly = /failed to fetch|http request failed|timeout|network/i.test(raw)
        ? `RPC connection failed at ${rpcUrl}. Connect local Hardhat node or check network.`
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
      setNotice({ tone: "error", text: "No injected Web3 wallet found. Please install MetaMask or Rabby." });
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainIdHex, 16);
      if (chainId !== RITUAL_CHAIN_ID) {
        throw new Error(`Wallet is on chain ID ${chainId}. Please switch your wallet to Ritual Chain (ID ${RITUAL_CHAIN_ID}).`);
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
      setNotice({ tone: "pending", text: `${label} transaction broadcasted (${shortAddress(hash)}). Waiting for confirmation...` });
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

  function toggleOracle(id: string) {
    setExpandedOracle((prev) => ({ ...prev, [id]: !prev[id] }));
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
    <div className="hyper-shell">
      <a className="skip-link" href="#markets">Skip to markets</a>

      {/* Atmospheric Visual Layers */}
      <div className="cosmic-canvas">
        <div className="aurora aurora-emerald" />
        <div className="aurora aurora-cyan" />
        <div className="aurora aurora-indigo" />
        <div className="cyber-grid" />
        <div className="starlight" />
      </div>

      {/* Header Bar */}
      <header className="master-nav">
        <div className="nav-container">
          <a className="brand-emblem" href="#top" aria-label="Ritual Predict Home">
            <div className="emblem-shield">
              <Zap size={22} className="emblem-bolt" />
              <div className="emblem-radar" />
            </div>
            <div className="brand-info">
              <div className="brand-headline">
                <span className="brand-name">RITUAL</span>
                <span className="brand-product">PREDICT</span>
              </div>
              <span className="brand-caption">Autonomous Prediction Infrastructure</span>
            </div>
          </a>

          <div className="nav-controls">
            <button
              className="hud-pill-btn"
              onClick={() => setShowConfig(!showConfig)}
              title="Protocol Console Configuration"
            >
              <Terminal size={15} />
              <span className="pill-text">Console</span>
            </button>

            <div className={`chain-status-capsule ${live ? "capsule-live" : "capsule-preview"}`}>
              <div className="pulsing-beacon">
                <span className="beacon-core" />
                <span className="beacon-wave" />
              </div>
              <span className="capsule-label">{live ? "Ritual (1979)" : "Preview Data"}</span>
            </div>

            <button className="tactile-wallet-btn" onClick={connectWallet}>
              <Wallet size={16} />
              <span>{account ? shortAddress(account) : "Connect Wallet"}</span>
            </button>
          </div>
        </div>

        {/* Expandable Protocol Node Console */}
        {showConfig && (
          <div className="protocol-console-tray">
            <div className="console-tray-inner">
              <div className="tray-top-bar">
                <div className="tray-title-box">
                  <Terminal size={16} className="text-emerald" />
                  <span>Ritual Protocol Terminal & Node Config</span>
                </div>
                <button className="tray-close-btn" onClick={() => setShowConfig(false)}>
                  ✕
                </button>
              </div>

              <div className="console-status-box">
                <Network size={16} className="text-cyan flex-shrink-0" />
                <span>{networkReason}</span>
              </div>

              <div className="console-fields-row">
                <div className="console-field">
                  <label htmlFor="rpc-input">RPC Node URL</label>
                  <input
                    id="rpc-input"
                    value={rpcUrl}
                    onChange={(e) => setRpcUrl(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="console-field">
                  <div className="field-label-split">
                    <label htmlFor="contract-input">RitualPredict Contract</label>
                    {contractAddress && (
                      <button
                        type="button"
                        className="copy-chip"
                        onClick={() => copyText(contractAddress, "contract")}
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
                <div className="console-actions">
                  <button className="button apply-btn" onClick={applyConnection}>
                    Apply Node Config
                  </button>
                  <button
                    className="button refresh-icon-btn"
                    onClick={() => void refresh()}
                    aria-label="Refresh telemetry"
                  >
                    <RefreshCw size={16} className={loading ? "spin-infinite" : ""} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main App Container */}
      <main className="master-content">
        {/* Hero Section */}
        <section className="command-hero" id="top">
          <div className="hero-announcement">
            <Sparkles size={14} className="text-emerald" />
            <span>Zero Off-Chain Keepers · Native TEE Verification · Permissionless Safety Rescue</span>
          </div>

          <div className="hero-split-grid">
            <div className="hero-left-column">
              <h1 className="hero-glory-title">
                Markets that wake up, <br />
                <span className="shimmer-text">resolve via TEE</span>, and settle themselves.
              </h1>
              <p className="hero-sub-statement">
                Built natively on Ritual Chain. Ritual Scheduler triggers execution at designated blocks.
                TEE workers fetch HTTP oracles in enclaves, extract values with JQ precompiles, and settle pari-mutuel payouts autonomously.
              </p>

              <div className="hero-action-dock">
                <button
                  className="button glory-cta-primary"
                  onClick={() => setShowCreate(true)}
                  disabled={!live}
                >
                  <Plus size={18} />
                  <span>Create Market</span>
                </button>
                <a className="button glory-cta-secondary" href="#markets">
                  <span>Explore Markets</span>
                  <ArrowRight size={16} />
                </a>
                <a className="glory-link" href="#resolution-engine">
                  <span>How Resolution Works</span>
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>

            {/* Hero Right Visual: Live Pipeline Card */}
            <div className="hero-pipeline-preview">
              <div className="preview-glass-card">
                <div className="preview-card-header">
                  <div className="protocol-dots">
                    <span className="dot-red" />
                    <span className="dot-yellow" />
                    <span className="dot-green" />
                  </div>
                  <span className="preview-terminal-tag">RITUAL_ORCHESTRATION_CORE</span>
                </div>

                <div className="pipeline-flow-rows">
                  <div className="pipeline-row active">
                    <div className="row-badge">01</div>
                    <div className="row-icon-box">
                      <Clock3 size={16} />
                    </div>
                    <div className="row-details">
                      <strong>Scheduler Wake-up</strong>
                      <span>3 automated retries booked at block delta</span>
                    </div>
                    <div className="row-status-pill green">ACTIVE</div>
                  </div>

                  <div className="pipeline-row">
                    <div className="row-badge">02</div>
                    <div className="row-icon-box">
                      <ShieldCheck size={16} />
                    </div>
                    <div className="row-details">
                      <strong>TEE Enclave Selection</strong>
                      <span>HTTP_CALL capability dynamically matched</span>
                    </div>
                    <div className="row-status-pill cyan">VERIFIED</div>
                  </div>

                  <div className="pipeline-row">
                    <div className="row-badge">03</div>
                    <div className="row-icon-box">
                      <Code2 size={16} />
                    </div>
                    <div className="row-details">
                      <strong>HTTP + JQ Precompiles</strong>
                      <span>0x0801 & 0x0803 cryptographic parse</span>
                    </div>
                    <div className="row-status-pill purple">AUTOMATED</div>
                  </div>

                  <div className="pipeline-row">
                    <div className="row-badge">04</div>
                    <div className="row-icon-box">
                      <RotateCcw size={16} />
                    </div>
                    <div className="row-details">
                      <strong>Settlement or Rescue</strong>
                      <span>Instant claimable winnings or total refund</span>
                    </div>
                    <div className="row-status-pill amber">PROTECTED</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Global Telemetry HUD */}
        <section className="telemetry-dashboard" aria-label="Ritual Chain Live Telemetry">
          <div className="telemetry-tile tile-emerald">
            <div className="tile-glow" />
            <div className="tile-icon-wrapper">
              <Layers3 size={20} />
            </div>
            <div className="tile-body">
              <span className="tile-title">Active / Total Markets</span>
              <span className="tile-main-stat">{activeMarkets} / {displayedMarkets.length}</span>
              <span className="tile-meta">{live ? "On-Chain Live" : "Preview Fixtures"}</span>
            </div>
          </div>

          <div className="telemetry-tile tile-cyan">
            <div className="tile-glow" />
            <div className="tile-icon-wrapper">
              <CircleDollarSign size={20} />
            </div>
            <div className="tile-body">
              <span className="tile-title">Total Staked Volume</span>
              <span className="tile-main-stat">{formatRitual(totalPool)}</span>
              <span className="tile-meta">Pari-mutuel Pools</span>
            </div>
          </div>

          <div className="telemetry-tile tile-purple">
            <div className="tile-glow" />
            <div className="tile-icon-wrapper">
              <Gauge size={20} />
            </div>
            <div className="tile-body">
              <span className="tile-title">Scheduler Gas Treasury</span>
              <span className="tile-main-stat">{live ? formatRitual(executionBalance) : "0.5000 RITUAL"}</span>
              <span className="tile-meta">Prepaid Execution Balance</span>
            </div>
          </div>

          <div className="telemetry-tile tile-amber">
            <div className="tile-glow" />
            <div className="tile-icon-wrapper">
              <Clock3 size={20} />
            </div>
            <div className="tile-body">
              <span className="tile-title">Ritual Block Height</span>
              <span className="tile-main-stat">{blockNumber ? `#${blockNumber.toString()}` : "Syncing..."}</span>
              <span className="tile-meta">~195ms Block Interval</span>
            </div>
          </div>
        </section>

        {/* Market Board Section */}
        <section className="markets-arena" id="markets">
          <div className="arena-header">
            <div className="arena-title-stack">
              <div className="arena-eyebrow">
                <Flame size={14} className="text-emerald" />
                <span>Prediction Terminal</span>
              </div>
              <h2 className="arena-heading">Active Prediction Markets</h2>
            </div>

            {/* Filter & Search Bar */}
            <div className="arena-dock-controls">
              <div className="cyber-search-wrapper">
                <Search size={15} className="search-icon" />
                <input
                  type="text"
                  placeholder="Search question, token, or market ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button className="search-reset-btn" onClick={() => setSearchQuery("")}>✕</button>
                )}
              </div>

              <div className="segmented-filter-bar">
                {(
                  [
                    { key: "all", label: "All Markets" },
                    { key: "open", label: "Open" },
                    { key: "resolving", label: "Resolving" },
                    { key: "resolved", label: "Resolved" },
                    { key: "invalid", label: "Invalid" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    className={`segmented-tab ${filterState === tab.key ? "is-active" : ""}`}
                    onClick={() => setFilterState(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!live && (
            <div className="preview-alert-strip">
              <Info size={18} className="text-amber flex-shrink-0" />
              <div className="preview-alert-content">
                <strong>Preview Demonstration Dataset</strong>
                <p>Showing sample markets. Connect to a live Ritual node to execute real on-chain stakes, claims, and automated settlements.</p>
              </div>
            </div>
          )}

          {/* Market Cards Grid */}
          <div className="arena-cards-grid">
            {filteredMarkets.length === 0 ? (
              <div className="empty-terminal-state">
                <HelpCircle size={44} className="text-muted" />
                <h3>No prediction markets found</h3>
                <p>Try adjusting your search criteria or switching the filter tab.</p>
                <button
                  className="button glory-cta-secondary"
                  onClick={() => { setFilterState("all"); setSearchQuery(""); }}
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              filteredMarkets.map((market) => {
                const pool = market.totalYes + market.totalNo;
                const yesPct = pool === 0n ? 50 : Number((market.totalYes * 10_000n) / pool) / 100;
                const noPct = 100 - yesPct;
                const yesMultiplier = market.totalYes > 0n ? (Number(pool) / Number(market.totalYes)).toFixed(2) : "2.00";
                const noMultiplier = market.totalNo > 0n ? (Number(pool) / Number(market.totalNo)).toFixed(2) : "2.00";
                const canBet = live && account && market.state === 0 && blockNumber !== null && blockNumber < market.closeBlock;
                const canClaim = live && account && market.stake && market.stake.claimable > 0n && !market.stake.settled;
                const canRescue = live && account && market.rescueBlock && blockNumber !== null && blockNumber > market.rescueBlock && market.state < 3;
                const isResolved = market.state === 3;
                const isInvalid = market.state === 4;
                const currentBet = betAmounts[market.id.toString()] ?? "0.1";
                const isOracleOpen = Boolean(expandedOracle[market.id.toString()]);

                return (
                  <article className={`tactical-card ${stateTone(market.state)}`} key={market.id.toString()}>
                    <div className="tactical-card-top">
                      <div className="market-serial-tag">
                        <span className="serial-hash">#</span>
                        <span>MARKET-{market.id.toString()}</span>
                      </div>
                      <div className={`status-badge-glow ${stateTone(market.state)}`}>
                        <span className="glowing-orb" />
                        <span>{MARKET_STATE[market.state] ?? "Unknown"}</span>
                      </div>
                    </div>

                    <h3 className="market-prompt-title">{market.question}</h3>

                    {/* Condition Box */}
                    <div className="terminal-condition-box">
                      <div className="condition-lead-row">
                        <Target size={14} className="text-emerald" />
                        <span className="condition-label">RESOLUTION TARGET RULE</span>
                      </div>
                      <div className="condition-formula">
                        <span className="formula-part">Observed Value</span>
                        <span className="formula-operator">{COMPARATOR[market.comparator]}</span>
                        <span className="formula-target">{market.target.toString()}</span>
                      </div>
                    </div>

                    {/* Probability Gauge & Dual Chamber */}
                    <div className="dual-chamber-gauge">
                      <div className="chamber-bar">
                        <div className="chamber-fill-yes" style={{ width: `${yesPct}%` }} />
                        <div className="chamber-fill-no" style={{ width: `${noPct}%` }} />
                      </div>
                      <div className="chamber-data-row">
                        <div className="chamber-side yes">
                          <span className="bullet-dot yes" />
                          <span className="chamber-name">YES</span>
                          <span className="chamber-percent">{yesPct.toFixed(1)}%</span>
                          <span className="chamber-multiplier">{yesMultiplier}x</span>
                        </div>
                        <div className="chamber-side no">
                          <span className="chamber-multiplier">{noMultiplier}x</span>
                          <span className="chamber-percent">{noPct.toFixed(1)}%</span>
                          <span className="chamber-name">NO</span>
                          <span className="bullet-dot no" />
                        </div>
                      </div>
                    </div>

                    {/* Stats Metrics Strip */}
                    <div className="card-metrics-strip">
                      <div className="metric-strip-item">
                        <span className="strip-label">Pool Liquidity</span>
                        <strong className="strip-value">{formatRitual(pool)}</strong>
                      </div>
                      <div className="metric-strip-item">
                        <span className="strip-label">Scheduler Retries</span>
                        <strong className="strip-value">{market.attempts} / 3</strong>
                      </div>
                      <div className="metric-strip-item">
                        <span className="strip-label">Schedule Ref</span>
                        <strong className="strip-value">#{market.scheduleId.toString()}</strong>
                      </div>
                    </div>

                    {/* Settlement Outcome Banner */}
                    {isResolved && (
                      <div className="resolution-verdict-box success">
                        <CheckCircle2 size={20} className="text-cyan flex-shrink-0" />
                        <div className="verdict-text">
                          <strong>Resolved Outcome: {OUTCOME[market.outcome]}</strong>
                          <span>Observed Oracle Telemetry: {market.observedValue.toString()}</span>
                        </div>
                      </div>
                    )}

                    {isInvalid && (
                      <div className="resolution-verdict-box danger">
                        <AlertTriangle size={20} className="text-rose flex-shrink-0" />
                        <div className="verdict-text">
                          <strong>Market Stalled or Inactive</strong>
                          <span>{market.invalidReason || "All participants are entitled to 100% principal stake refund."}</span>
                        </div>
                      </div>
                    )}

                    {/* Collapsible Oracle Transparency Tag */}
                    <div className="oracle-transparency-card">
                      <button
                        type="button"
                        className="oracle-toggle-btn"
                        onClick={() => toggleOracle(market.id.toString())}
                      >
                        <div className="oracle-summary-left">
                          <Code2 size={13} className="text-cyan" />
                          <span className="oracle-host-text">
                            {market.oracleUrl.replace(/^https?:\/\//, "").slice(0, 28)}
                            {market.oracleUrl.length > 35 ? "..." : ""}
                          </span>
                        </div>
                        <div className="oracle-summary-right">
                          <span className="jq-pill">JQ: {market.jsonPath}</span>
                          {isOracleOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                      </button>

                      {isOracleOpen && (
                        <div className="oracle-details-expand">
                          <div className="detail-line">
                            <span className="detail-key">Endpoint URL:</span>
                            <span className="detail-val">{market.oracleUrl}</span>
                          </div>
                          <div className="detail-line">
                            <span className="detail-key">JSON Query:</span>
                            <span className="detail-val">{market.jsonPath}</span>
                          </div>
                          <div className="detail-line">
                            <span className="detail-key">Execution Enclave:</span>
                            <span className="detail-val">Ritual TEE (HTTP_CALL 0x0801 + JQ 0x0803)</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* User Stake Info */}
                    {market.stake && (market.stake.yes > 0n || market.stake.no > 0n) && (
                      <div className="user-position-banner">
                        <span className="position-title">Your Stakes:</span>
                        <div className="position-tags">
                          <span className="position-pill yes">YES: {formatRitual(market.stake.yes)}</span>
                          <span className="position-pill no">NO: {formatRitual(market.stake.no)}</span>
                        </div>
                      </div>
                    )}

                    {/* Action Hub */}
                    <div className="card-execution-hub">
                      <div className="stake-amount-control">
                        <div className="stake-control-header">
                          <label htmlFor={`bet-${market.id}`}>Stake Amount (RITUAL)</label>
                          <div className="preset-quick-chips">
                            {["0.1", "0.5", "1.0", "5.0"].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                className="quick-chip"
                                onClick={() => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: preset }))}
                                disabled={!canBet}
                              >
                                +{preset}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="stake-input-box">
                          <input
                            id={`bet-${market.id}`}
                            inputMode="decimal"
                            value={currentBet}
                            onChange={(e) => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: e.target.value }))}
                            disabled={!canBet}
                            placeholder="0.1"
                          />
                          <span className="input-currency-label">RITUAL</span>
                        </div>
                      </div>

                      <div className="binary-action-row">
                        <button
                          className="binary-btn yes"
                          disabled={!canBet}
                          onClick={() =>
                            runTransaction("Stake YES", {
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
                          className="binary-btn no"
                          disabled={!canBet}
                          onClick={() =>
                            runTransaction("Stake NO", {
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
                          className="button claim-verdict-btn"
                          onClick={() =>
                            runTransaction(isInvalid ? "Claim Full Refund" : "Claim Settlement Winnings", {
                              functionName: isInvalid ? "claimRefund" : "claimWinnings",
                              args: [market.id],
                            })
                          }
                        >
                          <Sparkles size={16} />
                          <span>{isInvalid ? "Claim 100% Principal Refund" : `Claim Reward: ${formatRitual(market.stake!.claimable)}`}</span>
                        </button>
                      )}

                      {canRescue && (
                        <button
                          className="button rescue-verdict-btn"
                          onClick={() =>
                            runTransaction("Rescue Expired Market", {
                              functionName: "rescueExpiredMarket",
                              args: [market.id],
                            })
                          }
                        >
                          <ShieldAlert size={16} />
                          <span>Execute Permissionless Safety Rescue & Unlock Refunds</span>
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
        <section className="engine-architecture-zone" id="resolution-engine">
          <div className="engine-zone-header">
            <div className="arena-eyebrow">
              <Zap size={14} className="text-emerald" />
              <span>Ritual-Native Cryptographic Infrastructure</span>
            </div>
            <h2 className="arena-heading">How Self-Resolving Execution Works</h2>
            <p className="engine-lead-text">
              Markets run completely autonomously. Creation books future execution blocks directly with the Ritual Scheduler, and TEE workers securely resolve the outcome without human or bot intervention.
            </p>
          </div>

          <div className="engine-conduit-grid">
            <div className="conduit-card">
              <div className="conduit-step-num">STAGE 01</div>
              <div className="conduit-icon emerald">
                <Clock3 size={24} />
              </div>
              <h3 className="conduit-title">Scheduler Wake-up</h3>
              <p className="conduit-desc">
                When created, the market books 3 scheduled executions with the Ritual Scheduler contract. No off-chain bot or keeper infrastructure is needed.
              </p>
            </div>

            <div className="conduit-card">
              <div className="conduit-step-num">STAGE 02</div>
              <div className="conduit-icon cyan">
                <ShieldCheck size={24} />
              </div>
              <h3 className="conduit-title">TEE Enclave Selection</h3>
              <p className="conduit-desc">
                The on-chain TEEServiceRegistry selects an active, verifiable HTTP-capable executor for each attempt using randomized seeds.
              </p>
            </div>

            <div className="conduit-card">
              <div className="conduit-step-num">STAGE 03</div>
              <div className="conduit-icon purple">
                <Code2 size={24} />
              </div>
              <h3 className="conduit-title">HTTP & JQ Precompiles</h3>
              <p className="conduit-desc">
                The executor calls the HTTP precompile (0x0801) to fetch public API data, and the JQ precompile (0x0803) parses the target uint256 value.
              </p>
            </div>

            <div className="conduit-card">
              <div className="conduit-step-num">STAGE 04</div>
              <div className="conduit-icon amber">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="conduit-title">Settlement or Rescue</h3>
              <p className="conduit-desc">
                The observed value determines YES or NO settlement. If 3 attempts fail or execution is stalled, the market unlocks full stakeholder refunds.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Toast Notification HUD */}
      {notice && (
        <div className={`cyber-toast ${notice.tone}`} role="alert" aria-live="polite">
          <div className="toast-leading-icon">
            {notice.tone === "pending" ? (
              <LoaderCircle className="spin-infinite text-cyan" size={22} />
            ) : notice.tone === "success" ? (
              <CheckCircle2 className="text-emerald" size={22} />
            ) : (
              <AlertCircle className="text-rose" size={22} />
            )}
          </div>
          <div className="toast-body-text">
            <span className="toast-badge-title">
              {notice.tone === "pending" ? "Transaction Pending" : notice.tone === "success" ? "Execution Confirmed" : "Execution Error"}
            </span>
            <p className="toast-detail">{notice.text}</p>
          </div>
          <button className="toast-close-btn" onClick={() => setNotice(null)} aria-label="Dismiss toast">
            ✕
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="master-footer">
        <div className="footer-content-wrap">
          <div className="footer-left-info">
            <div className="footer-brand-lockup">
              <Zap size={18} className="text-emerald" />
              <strong>Ritual Predict</strong>
            </div>
            <span className="footer-tagline">Built for Ritual Chain Workshop 2 · Proof of Building</span>
          </div>
          <div className="footer-right-links">
            <a
              href="https://github.com/duclucky/ritual-chain-workshop-2"
              target="_blank"
              rel="noreferrer"
              className="footer-nav-link"
            >
              <span>GitHub Repository</span>
              <ExternalLink size={14} />
            </a>
            <a
              href="https://docs.ritualfoundation.org"
              target="_blank"
              rel="noreferrer"
              className="footer-nav-link"
            >
              <span>Ritual Docs</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </footer>

      {/* Create Market Modal Dialog */}
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
      className="modal-glass-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section className="modal-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modal-top-row">
          <div className="modal-heading-stack">
            <span className="modal-eyebrow">IMMUTABLE ON-CHAIN SPECIFICATION</span>
            <h2 id="create-title">Create Autonomous Market</h2>
          </div>
          <button className="modal-dismiss-btn" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form ref={formRef} onSubmit={submit} noValidate className="modal-dialog-form">
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

          <div className="modal-grid-two">
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

          <div className="modal-grid-three">
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

          <div className="modal-immutable-notice">
            <LockKeyhole size={18} className="text-purple flex-shrink-0" />
            <span>
              All parameters (oracle endpoint, JSON path, comparator rule, execution block deadlines) are permanently immutable once committed on-chain.
            </span>
          </div>

          <div className="modal-bottom-actions">
            <button type="button" className="button modal-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="button modal-submit-btn" type="submit">
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
    <div className="modal-field-unit">
      <label htmlFor={id} className="field-unit-label">
        <span>{label}</span>
      </label>
      {control}
      {error && (
        <small className="field-unit-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

export default App;

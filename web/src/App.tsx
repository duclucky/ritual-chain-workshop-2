import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bookmark,
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
  Globe,
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
const RITUAL_CHAIN_ID_HEX = "0x7bb";
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
  category?: string;
  rescueBlock?: bigint;
  stake?: StakeInfo;
  preview?: boolean;
};

type LocalDemoConfig = { address?: Address; rpcUrl?: string; chainId?: number };

declare global {
  interface Window {
    ethereum?: EIP1193Provider & {
      providers?: EIP1193Provider[];
      isMetaMask?: boolean;
      isRabby?: boolean;
      isCoinbaseWallet?: boolean;
      isOKExWallet?: boolean;
    };
    okxwallet?: EIP1193Provider;
    coinbaseWalletExtension?: EIP1193Provider;
    phantom?: { ethereum?: EIP1193Provider };
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
    category: "Crypto",
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
    category: "Crypto",
    preview: true,
  },
  {
    id: 1n,
    creator: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    question: "Will Ritual Chain peak TPS reach 2,500 operations per second?",
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
    category: "Tech & AI",
    preview: true,
  },
];

function shortAddress(value?: string) {
  if (!value) return "Not set";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatRitual(value: bigint) {
  const n = Number(formatEther(value));
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} RITUAL`;
}

function stateColorClass(state: number) {
  if (state === 3) return "badge-resolved";
  if (state === 4) return "badge-invalid";
  if (state === 2) return "badge-resolving";
  if (state === 1) return "badge-closed";
  return "badge-open";
}

function getMarketCategory(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("eth") || q.includes("btc") || q.includes("sol") || q.includes("price") || q.includes("usd")) {
    return "Crypto";
  }
  if (q.includes("tps") || q.includes("ai") || q.includes("model") || q.includes("chain") || q.includes("gpu")) {
    return "Tech & AI";
  }
  return "Ritual Core";
}

function getActiveEthereumProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  if (window.ethereum) {
    if (Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 0) {
      return window.ethereum.providers[0];
    }
    return window.ethereum;
  }
  if (window.okxwallet) return window.okxwallet;
  if (window.coinbaseWalletExtension) return window.coinbaseWalletExtension;
  if (window.phantom?.ethereum) return window.phantom.ethereum;
  return null;
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
  const [networkReason, setNetworkReason] = useState("Connecting to Ritual RPC node...");
  const [account, setAccount] = useState<Address | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [betAmounts, setBetAmounts] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [filterCategory, setFilterCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [expandedOracle, setExpandedOracle] = useState<Record<string, boolean>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

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
        setNetworkReason("Ritual node connected. Provide a RitualPredict contract address to load markets.");
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
            category: getMarketCategory(m.question),
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

  // EIP-1193 & EIP-6963 Auto-detection and accounts sync
  useEffect(() => {
    const provider = getActiveEthereumProvider();
    if (!provider) return;

    // Check existing authorization
    provider
      .request({ method: "eth_accounts" })
      .then((accounts: any) => {
        if (Array.isArray(accounts) && accounts.length > 0 && isAddress(accounts[0])) {
          setAccount(accounts[0] as Address);
        }
      })
      .catch(() => undefined);

    const handleAccountsChanged = (accounts: unknown) => {
      if (Array.isArray(accounts) && accounts.length > 0 && isAddress(accounts[0])) {
        setAccount(accounts[0] as Address);
        setNotice({ tone: "success", text: `Active wallet account: ${shortAddress(accounts[0])}` });
      } else {
        setAccount(null);
      }
    };

    const handleChainChanged = () => {
      void refresh();
    };

    if (typeof (provider as any).on === "function") {
      (provider as any).on("accountsChanged", handleAccountsChanged);
      (provider as any).on("chainChanged", handleChainChanged);
    }

    return () => {
      if (typeof (provider as any).removeListener === "function") {
        (provider as any).removeListener("accountsChanged", handleAccountsChanged);
        (provider as any).removeListener("chainChanged", handleChainChanged);
      }
    };
  }, [refresh]);

  async function connectWallet() {
    const provider = getActiveEthereumProvider();
    if (!provider) {
      setNotice({
        tone: "error",
        text: "No EVM wallet detected in your browser. Please install an EVM wallet extension (e.g. MetaMask, Rabby, OKX, Coinbase) or open this page in your Web3 wallet browser.",
      });
      return;
    }

    try {
      setNotice({ tone: "pending", text: "Connecting to EVM wallet..." });
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      if (!accounts || accounts.length === 0) throw new Error("No accounts authorized by wallet.");

      // Check Chain ID
      const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
      const chainId = Number.parseInt(chainIdHex, 16);

      if (chainId !== RITUAL_CHAIN_ID) {
        // Attempt to auto-switch or add Ritual Chain to user wallet
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: RITUAL_CHAIN_ID_HEX }],
          });
        } catch (switchError: any) {
          // 4902 code means chain is not added yet
          if (switchError?.code === 4902 || switchError?.data?.originalError?.code === 4902 || /unrecognized|unknown/i.test(switchError?.message ?? "")) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: RITUAL_CHAIN_ID_HEX,
                  chainName: "Ritual Chain",
                  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
                  rpcUrls: [rpcUrl, DEFAULT_RPC],
                },
              ],
            });
          } else {
            throw new Error(`Please switch your wallet network to Ritual Chain (ID ${RITUAL_CHAIN_ID}).`);
          }
        }
      }

      setAccount(accounts[0]);
      setNotice({ tone: "success", text: `Wallet connected: ${shortAddress(accounts[0])}` });
      await refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Wallet connection failed." });
    }
  }

  async function runTransaction(
    label: string,
    request: { functionName: string; args?: readonly unknown[]; value?: bigint },
  ) {
    const provider = getActiveEthereumProvider();
    if (!provider || !account || !contractAddress || !live) {
      setNotice({ tone: "error", text: "Please connect your wallet and verify the live contract first." });
      return;
    }
    setNotice({ tone: "pending", text: `${label}: Waiting for wallet confirmation...` });
    try {
      const walletClient = createWalletClient({ account, chain: ritualChain, transport: custom(provider) });
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: ritualPredictAbi,
        functionName: request.functionName as any,
        args: request.args as any,
        value: request.value,
      } as any);
      setNotice({ tone: "pending", text: `${label} submitted (${shortAddress(hash)}). Waiting for confirmation...` });
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

  function toggleFavorite(id: string) {
    setFavorites((prev) => ({ ...prev, [id]: !prev[id] }));
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
      if (filterCategory === "all") return true;
      if (filterCategory === "crypto") return (m.category || getMarketCategory(m.question)) === "Crypto";
      if (filterCategory === "tech") return (m.category || getMarketCategory(m.question)) === "Tech & AI";
      if (filterCategory === "open") return m.state === 0;
      if (filterCategory === "resolving") return m.state === 1 || m.state === 2;
      if (filterCategory === "resolved") return m.state === 3;
      if (filterCategory === "invalid") return m.state === 4;
      if (filterCategory === "favorites") return Boolean(favorites[m.id.toString()]);
      return true;
    });
  }, [displayedMarkets, filterCategory, searchQuery, favorites]);

  return (
    <div className="ritual-app">
      <a className="skip-link" href="#markets">Skip to markets</a>

      {/* Top Navigation Bar */}
      <header className="ritual-navbar">
        <div className="ritual-nav-inner">
          {/* Logo Brand */}
          <a className="ritual-brand" href="#top">
            <div className="ritual-logo-glyph">
              <Zap size={20} className="glyph-icon" />
            </div>
            <div className="ritual-brand-titles">
              <span className="ritual-title">Ritual Predict</span>
              <span className="ritual-tag">Autonomous Core</span>
            </div>
          </a>

          {/* Center Search Bar */}
          <div className="ritual-search-hub">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search prediction markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear-button" onClick={() => setSearchQuery("")}>
                ✕
              </button>
            )}
          </div>

          {/* Right Controls */}
          <div className="ritual-nav-actions">
            <button
              className="ritual-action-btn launchpad-cta"
              onClick={() => setShowCreate(true)}
              disabled={!live}
            >
              <Plus size={16} />
              <span>Launchpad</span>
            </button>

            <button
              className="ritual-action-btn config-btn"
              onClick={() => setShowConfig(!showConfig)}
              title="Protocol Console"
            >
              <Terminal size={15} />
              <span className="btn-label">Console</span>
            </button>

            <div className={`ritual-network-pill ${live ? "is-live" : "is-preview"}`}>
              <span className="network-dot" />
              <span>{live ? "Ritual (1979)" : "Preview Mode"}</span>
            </div>

            <button className="ritual-wallet-btn" onClick={connectWallet}>
              <Wallet size={16} />
              <span>{account ? shortAddress(account) : "Connect Wallet"}</span>
            </button>
          </div>
        </div>

        {/* Expandable Protocol Node Console */}
        {showConfig && (
          <div className="ritual-console-drawer">
            <div className="console-drawer-container">
              <div className="drawer-top-row">
                <div className="drawer-heading">
                  <Terminal size={16} className="text-emerald" />
                  <span>Ritual Protocol Node & Contract Configuration</span>
                </div>
                <button className="drawer-close-btn" onClick={() => setShowConfig(false)}>
                  ✕
                </button>
              </div>

              <div className="drawer-status-strip">
                <Network size={16} className="text-cyan flex-shrink-0" />
                <span>{networkReason}</span>
              </div>

              <div className="drawer-input-row">
                <div className="drawer-field">
                  <label htmlFor="rpc-input">RPC Node URL</label>
                  <input
                    id="rpc-input"
                    value={rpcUrl}
                    onChange={(e) => setRpcUrl(e.target.value)}
                    spellCheck={false}
                  />
                </div>
                <div className="drawer-field">
                  <div className="field-header-row">
                    <label htmlFor="contract-input">RitualPredict Contract</label>
                    {contractAddress && (
                      <button
                        type="button"
                        className="copy-badge"
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
                <div className="drawer-actions">
                  <button className="button apply-settings-btn" onClick={applyConnection}>
                    Apply Settings
                  </button>
                  <button
                    className="button refresh-btn"
                    onClick={() => void refresh()}
                    aria-label="Refresh telemetry"
                  >
                    <RefreshCw size={16} className={loading ? "spin-loop" : ""} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="ritual-main-layout">
        {/* Signature Gradient Hero Banner */}
        <section className="ritual-hero-banner" id="top">
          <div className="banner-glass-inner">
            <div className="banner-content-row">
              <div className="banner-titles">
                <h1 className="banner-headline">Predict the future</h1>
                <p className="banner-subline">Shape the present</p>
              </div>

              <div className="banner-toggle-area">
                <button
                  type="button"
                  className="banner-expand-btn"
                  onClick={() => setBannerExpanded(!bannerExpanded)}
                  aria-label="Toggle protocol telemetry"
                  aria-expanded={bannerExpanded}
                >
                  <span className="expand-label">{bannerExpanded ? "Hide Telemetry" : "Protocol Telemetry"}</span>
                  {bannerExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {/* Expandable Telemetry Row inside Hero Banner */}
            {bannerExpanded && (
              <div className="banner-telemetry-grid">
                <div className="telemetry-box">
                  <span className="telemetry-label">Active / Total Markets</span>
                  <strong className="telemetry-val">{activeMarkets} / {displayedMarkets.length}</strong>
                  <span className="telemetry-sub">{live ? "On-Chain Live" : "Preview Fixtures"}</span>
                </div>
                <div className="telemetry-box">
                  <span className="telemetry-label">Total Staked Liquidity</span>
                  <strong className="telemetry-val">{formatRitual(totalPool)}</strong>
                  <span className="telemetry-sub">Pari-mutuel Pools</span>
                </div>
                <div className="telemetry-box">
                  <span className="telemetry-label">Scheduler Gas Treasury</span>
                  <strong className="telemetry-val">{live ? formatRitual(executionBalance) : "0.5000 RITUAL"}</strong>
                  <span className="telemetry-sub">Prepaid Execution</span>
                </div>
                <div className="telemetry-box">
                  <span className="telemetry-label">Ritual Block Height</span>
                  <strong className="telemetry-val">{blockNumber ? `#${blockNumber.toString()}` : "Syncing..."}</strong>
                  <span className="telemetry-sub">~195ms Block Time</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Categories / Navigation Pill Bar */}
        <section className="ritual-filter-ribbon">
          <div className="category-pills-list">
            {[
              { key: "all", label: "All Markets", icon: <Layers3 size={15} /> },
              { key: "crypto", label: "Crypto", icon: <CircleDollarSign size={15} /> },
              { key: "tech", label: "Tech & AI", icon: <Sparkles size={15} /> },
              { key: "open", label: "Open Now", icon: <Flame size={15} /> },
              { key: "resolving", label: "In Resolution", icon: <Clock3 size={15} /> },
              { key: "resolved", label: "Resolved", icon: <CheckCircle2 size={15} /> },
              { key: "invalid", label: "Rescue / Refund", icon: <ShieldAlert size={15} /> },
              { key: "favorites", label: "Favorites", icon: <Bookmark size={15} /> },
            ].map((cat) => (
              <button
                key={cat.key}
                className={`category-pill ${filterCategory === cat.key ? "is-selected" : ""}`}
                onClick={() => setFilterCategory(cat.key)}
              >
                {cat.icon}
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Offline / Preview Mode Notice */}
        {!live && (
          <div className="ritual-preview-strip">
            <Info size={18} className="text-amber flex-shrink-0" />
            <div className="preview-text">
              <strong>Preview Mode Active</strong>
              <span>Displaying sample markets. Connect to a live Ritual Chain node to execute real on-chain predictions and payouts.</span>
            </div>
          </div>
        )}

        {/* Markets Cards Grid */}
        <section className="ritual-cards-arena" id="markets">
          {filteredMarkets.length === 0 ? (
            <div className="ritual-empty-state">
              <HelpCircle size={48} className="text-muted" />
              <h3>No markets found</h3>
              <p>Try searching for a different keyword or resetting your filter category.</p>
              <button
                className="button reset-filter-btn"
                onClick={() => { setFilterCategory("all"); setSearchQuery(""); }}
              >
                View All Markets
              </button>
            </div>
          ) : (
            <div className="ritual-grid-layout">
              {filteredMarkets.map((market) => {
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
                const isFav = Boolean(favorites[market.id.toString()]);
                const isOracleOpen = Boolean(expandedOracle[market.id.toString()]);

                return (
                  <article className="ritual-card" key={market.id.toString()}>
                    {/* Card Header */}
                    <div className="ritual-card-header">
                      <div className="header-meta-left">
                        <span className="category-tag">{market.category || "Ritual"}</span>
                        <span className="market-id-chip">#{market.id.toString()}</span>
                      </div>
                      <div className="header-meta-right">
                        <span className={`ritual-badge ${stateColorClass(market.state)}`}>
                          {MARKET_STATE[market.state] ?? "Unknown"}
                        </span>
                        <button
                          type="button"
                          className={`favorite-toggle ${isFav ? "is-fav" : ""}`}
                          onClick={() => toggleFavorite(market.id.toString())}
                          aria-label="Save to favorites"
                        >
                          <Bookmark size={15} fill={isFav ? "currentColor" : "none"} />
                        </button>
                      </div>
                    </div>

                    {/* Market Question */}
                    <h3 className="ritual-card-title">{market.question}</h3>

                    {/* Criteria Box */}
                    <div className="ritual-criteria-pill">
                      <Target size={13} className="text-emerald" />
                      <span>Resolves YES if value {COMPARATOR[market.comparator]} {market.target.toString()}</span>
                    </div>

                    {/* Dual Probability Bar */}
                    <div className="ritual-odds-module">
                      <div className="odds-gauge-track">
                        <div className="gauge-fill-yes" style={{ width: `${yesPct}%` }} />
                        <div className="gauge-fill-no" style={{ width: `${noPct}%` }} />
                      </div>

                      <div className="odds-stats-line">
                        <div className="stat-side yes">
                          <span className="dot yes" />
                          <span className="name">YES</span>
                          <span className="pct">{yesPct.toFixed(1)}%</span>
                          <span className="multiplier">{yesMultiplier}x</span>
                        </div>
                        <div className="stat-side no">
                          <span className="multiplier">{noMultiplier}x</span>
                          <span className="pct">{noPct.toFixed(1)}%</span>
                          <span className="name">NO</span>
                          <span className="dot no" />
                        </div>
                      </div>
                    </div>

                    {/* Quick Stake Controls */}
                    <div className="ritual-stake-controls">
                      <div className="stake-input-wrapper">
                        <input
                          id={`bet-${market.id}`}
                          inputMode="decimal"
                          value={currentBet}
                          onChange={(e) => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: e.target.value }))}
                          disabled={!canBet}
                          placeholder="0.1"
                        />
                        <span className="unit">RITUAL</span>
                      </div>

                      <div className="quick-chips-group">
                        {["0.1", "0.5", "1.0", "5.0"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="chip-btn"
                            onClick={() => setBetAmounts((prev) => ({ ...prev, [market.id.toString()]: preset }))}
                            disabled={!canBet}
                          >
                            +{preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Binary Action Buttons (Buy YES / Buy NO) */}
                    <div className="ritual-binary-buttons">
                      <button
                        className="bet-button yes-btn"
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
                        <span>Buy YES · {yesPct.toFixed(0)}%</span>
                      </button>

                      <button
                        className="bet-button no-btn"
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
                        <span>Buy NO · {noPct.toFixed(0)}%</span>
                      </button>
                    </div>

                    {/* Resolution Settlement Outcome */}
                    {isResolved && (
                      <div className="settlement-banner success">
                        <CheckCircle2 size={18} className="text-cyan flex-shrink-0" />
                        <div>
                          <strong>Outcome: {OUTCOME[market.outcome]}</strong>
                          <span>Observed Value: {market.observedValue.toString()}</span>
                        </div>
                      </div>
                    )}

                    {isInvalid && (
                      <div className="settlement-banner danger">
                        <AlertTriangle size={18} className="text-rose flex-shrink-0" />
                        <div>
                          <strong>Market Invalidated</strong>
                          <span>{market.invalidReason || "100% refund available for all participants."}</span>
                        </div>
                      </div>
                    )}

                    {/* User Stake Info */}
                    {market.stake && (market.stake.yes > 0n || market.stake.no > 0n) && (
                      <div className="user-stake-strip">
                        <span>Your Stakes:</span>
                        <span className="tag yes">YES: {formatRitual(market.stake.yes)}</span>
                        <span className="tag no">NO: {formatRitual(market.stake.no)}</span>
                      </div>
                    )}

                    {/* Claim or Rescue Action Buttons */}
                    {canClaim && (
                      <button
                        className="button ritual-claim-btn"
                        onClick={() =>
                          runTransaction(isInvalid ? "Claim Refund" : "Claim Winnings", {
                            functionName: isInvalid ? "claimRefund" : "claimWinnings",
                            args: [market.id],
                          })
                        }
                      >
                        <Sparkles size={16} />
                        <span>{isInvalid ? "Claim Full Refund" : `Claim Reward: ${formatRitual(market.stake!.claimable)}`}</span>
                      </button>
                    )}

                    {canRescue && (
                      <button
                        className="button ritual-rescue-btn"
                        onClick={() =>
                          runTransaction("Rescue Expired Market", {
                            functionName: "rescueExpiredMarket",
                            args: [market.id],
                          })
                        }
                      >
                        <ShieldAlert size={16} />
                        <span>Permissionless Safety Rescue (Unlock Refunds)</span>
                      </button>
                    )}

                    {/* Collapsible Oracle Transparency Row */}
                    <div className="oracle-transparency-box">
                      <button
                        type="button"
                        className="oracle-toggle-row"
                        onClick={() => toggleOracle(market.id.toString())}
                      >
                        <div className="oracle-left">
                          <Code2 size={13} className="text-cyan" />
                          <span className="url-preview">
                            {market.oracleUrl.replace(/^https?:\/\//, "").slice(0, 26)}
                            {market.oracleUrl.length > 30 ? "..." : ""}
                          </span>
                        </div>
                        <div className="oracle-right">
                          <span className="jq-badge">JQ: {market.jsonPath}</span>
                          {isOracleOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </div>
                      </button>

                      {isOracleOpen && (
                        <div className="oracle-drawer-content">
                          <div><strong>Oracle URL:</strong> {market.oracleUrl}</div>
                          <div><strong>JSON Path:</strong> {market.jsonPath}</div>
                          <div><strong>Execution:</strong> Ritual TEE (HTTP_CALL 0x0801 + JQ 0x0803)</div>
                        </div>
                      )}
                    </div>

                    {/* Card Footer Strip */}
                    <div className="ritual-card-footer">
                      <div className="footer-metric">
                        <span className="label">Volume</span>
                        <span className="val">{formatRitual(pool)}</span>
                      </div>
                      <div className="footer-metric">
                        <span className="label">Retries</span>
                        <span className="val">{market.attempts} / 3</span>
                      </div>
                      <div className="footer-metric">
                        <span className="label">Schedule</span>
                        <span className="val">#{market.scheduleId.toString()}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* How Self-Resolving Prediction Works */}
        <section className="ritual-architecture-section" id="resolution-engine">
          <div className="section-title-wrap">
            <span className="section-kicker">AUTONOMOUS ORCHESTRATION</span>
            <h2 className="section-title">How Self-Resolving Markets Work</h2>
            <p className="section-desc">
              Ritual Predict combines Ritual Scheduler with confidential TEE precompiles to create markets that resolve themselves automatically on-chain.
            </p>
          </div>

          <div className="architecture-grid">
            <div className="arch-card">
              <div className="step-tag">STAGE 01</div>
              <div className="arch-icon-well emerald">
                <Clock3 size={24} />
              </div>
              <h3>Scheduler Activation</h3>
              <p>Upon market creation, 3 future execution blocks are booked with the Ritual Scheduler. No off-chain keepers or admin triggers needed.</p>
            </div>

            <div className="arch-card">
              <div className="step-tag">STAGE 02</div>
              <div className="arch-icon-well cyan">
                <ShieldCheck size={24} />
              </div>
              <h3>TEE Enclave Selection</h3>
              <p>The on-chain TEEServiceRegistry selects an attested, HTTP-capable worker in an enclave using randomized seeds for each attempt.</p>
            </div>

            <div className="arch-card">
              <div className="step-tag">STAGE 03</div>
              <div className="arch-icon-well purple">
                <Globe size={24} />
              </div>
              <h3>HTTP + JQ Precompiles</h3>
              <p>The enclave worker executes HTTP precompile (0x0801) and filters the target uint256 number via JQ precompile (0x0803).</p>
            </div>

            <div className="arch-card">
              <div className="step-tag">STAGE 04</div>
              <div className="arch-icon-well amber">
                <RotateCcw size={24} />
              </div>
              <h3>Settlement & Rescue</h3>
              <p>Outcome is compared against target. If attempts exhaust or execution stalls, the permissionless rescue path unlocks 100% principal refunds.</p>
            </div>
          </div>
        </section>
      </main>

      {/* Floating Toast Notification */}
      {notice && (
        <div className={`ritual-toast ${notice.tone}`} role="alert" aria-live="polite">
          <div className="toast-icon">
            {notice.tone === "pending" ? (
              <LoaderCircle className="spin-loop text-cyan" size={20} />
            ) : notice.tone === "success" ? (
              <CheckCircle2 className="text-emerald" size={20} />
            ) : (
              <AlertCircle className="text-rose" size={20} />
            )}
          </div>
          <div className="toast-body">
            <span className="toast-title">
              {notice.tone === "pending" ? "Transaction Pending" : notice.tone === "success" ? "Transaction Confirmed" : "Error"}
            </span>
            <p className="toast-desc">{notice.text}</p>
          </div>
          <button className="toast-dismiss" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {/* Footer */}
      <footer className="ritual-footer">
        <div className="footer-wrap">
          <div className="footer-left">
            <div className="footer-brand">
              <Zap size={18} className="text-emerald" />
              <strong>Ritual Predict</strong>
            </div>
            <span className="footer-copyright">Built for Ritual Chain Workshop 2 · Proof of Building</span>
          </div>
          <div className="footer-links">
            <a href="https://github.com/duclucky/ritual-chain-workshop-2" target="_blank" rel="noreferrer" className="footer-link">
              <span>GitHub Repository</span>
              <ExternalLink size={13} />
            </a>
            <a href="https://docs.ritualfoundation.org" target="_blank" rel="noreferrer" className="footer-link">
              <span>Ritual Docs</span>
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </footer>

      {/* Create Market Launchpad Modal */}
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
      className="ritual-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
    >
      <section className="ritual-modal-card" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modal-header-strip">
          <div className="modal-title-group">
            <span className="modal-kicker">RITUAL LAUNCHPAD</span>
            <h2 id="create-title">Create Prediction Market</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>

        <form ref={formRef} onSubmit={submit} noValidate className="modal-form">
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

          <div className="modal-grid-2">
            <Field label="JSON Path Query" error={errors.jsonPath}>
              <input value={form.jsonPath} onChange={(e) => update("jsonPath", e.target.value)} placeholder=".price" />
            </Field>
            <Field label="Target Number (uint256)" error={errors.target}>
              <input
                inputMode="numeric"
                value={form.target}
                onChange={(e) => update("target", e.target.value)}
                placeholder="4000"
              />
            </Field>
          </div>

          <div className="modal-grid-3">
            <Field label="Resolution Comparator">
              <select value={form.comparator} onChange={(e) => update("comparator", e.target.value)}>
                <option value="0">Greater than (&gt;)</option>
                <option value="1">Greater or equal (≥)</option>
                <option value="2">Less than (&lt;)</option>
                <option value="3">Less or equal (≤)</option>
              </select>
            </Field>
            <Field label="Betting Window (sec)" error={errors.bettingSeconds}>
              <input
                inputMode="numeric"
                value={form.bettingSeconds}
                onChange={(e) => update("bettingSeconds", e.target.value)}
                placeholder="300"
              />
            </Field>
            <Field label="Resolve Delay (sec)" error={errors.resolveDelaySeconds}>
              <input
                inputMode="numeric"
                value={form.resolveDelaySeconds}
                onChange={(e) => update("resolveDelaySeconds", e.target.value)}
                placeholder="60"
              />
            </Field>
          </div>

          <div className="modal-immutable-alert">
            <LockKeyhole size={16} className="text-purple flex-shrink-0" />
            <span>Parameters (Oracle URL, JSON path, target, schedule intervals) cannot be altered once created on-chain.</span>
          </div>

          <div className="modal-actions-footer">
            <button type="button" className="button modal-cancel" onClick={onClose}>
              Cancel
            </button>
            <button className="button modal-submit" type="submit">
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
    <div className="form-field-unit">
      <label htmlFor={id} className="field-label">
        <span>{label}</span>
      </label>
      {control}
      {error && (
        <small className="field-error-text" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

export default App;

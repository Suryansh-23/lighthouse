export type Address = `0x${string}`;
export type ChainId = number;
export type RpcUrl = string;
export type IsoDate = string;

export interface AddressResolution {
  address: Address;
  scannedAt: IsoDate;
  scan: {
    mode: "workspaceChains" | "userChains" | "singleChain";
    chainsAttempted: ChainId[];
    chainsSucceeded: ChainId[];
    chainsFailed: { chainId: ChainId; reason: string }[];
  };
  perChain: Record<ChainId, ChainAddressInfo>;
}

export interface ChainAddressInfo {
  chainId: ChainId;
  chainName: string;
  kind: "EOA" | "Contract" | "Unknown";
  exists: boolean;
  isContract: boolean;
  nativeBalanceWei?: string;
  nonce?: number;
  contract?: {
    bytecodeHash?: string;
    deployment?: {
      creator?: Address;
      txHash?: string;
      blockNumber?: number;
    };
    classification?: ContractClassification;
    proxy?: ProxyInfo;
    metadata?: ContractMetadata;
  };
  token?: TokenInfo;
  labels?: LabelInfo[];
}

export type ContractClassification =
  | { type: "ERC20"; confidence: number }
  | { type: "ERC721"; confidence: number }
  | { type: "ERC1155"; confidence: number }
  | { type: "ERC4626"; confidence: number }
  | {
      type: "Proxy";
      confidence: number;
      proxyType?: "EIP1967" | "Transparent" | "UUPS" | "Beacon" | "Unknown";
    }
  | { type: "Multisig"; confidence: number; family?: "Safe" | "Other" }
  | { type: "Pool"; confidence: number; family?: "UniV2" | "UniV3" | "Curve" | "Balancer" | "Other" }
  | { type: "Unknown"; confidence: number };

export interface ProxyInfo {
  type?: "EIP1967" | "Transparent" | "UUPS" | "Beacon" | "Unknown";
  implementation?: Address;
}

export interface TokenInfo {
  standard: "ERC20" | "ERC721" | "ERC1155" | "ERC4626";
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  asset?: Address;
  totalAssets?: string;
  price?: {
    usd?: number;
    source: "defillama" | "explorer" | "manual";
    fetchedAt: IsoDate;
  };
}

export interface ContractMetadata {
  verified?: boolean;
  contractName?: string;
  abi?: unknown;
  sourceUrl?: string;
}

export interface LabelInfo {
  label: string;
  source: "workspace" | "explorer" | "defillama" | "heuristic";
  confidence?: number;
  url?: string;
}

export interface AddressBookEntry {
  address: Address;
  chains?: ChainId[];
  label?: string;
  notes?: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  pinned: boolean;
  occurrences?: OccurrenceRef[];
}

export interface OccurrenceRef {
  uri: string;
  range: {
    start: { line: number; char: number };
    end: { line: number; char: number };
  };
}

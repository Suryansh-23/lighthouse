const engine = require("../dist/index.js");

const STABLECOINS = {
  1: [
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  ],
  10: [
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  ],
  42161: [
    "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  ],
  8453: [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc",
  ],
  100: [
    "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d",
    "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83",
    "0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0",
    "0x4ECaBa5870353805a9F068101A40E0f32ed605C6",
  ],
};

class MemoryCache {
  constructor() {
    this.entries = new Map();
  }

  get(address) {
    return this.entries.get(address);
  }

  async set(address, value) {
    this.entries.set(address, value);
  }
}

function buildExpectedChains() {
  const expected = new Map();
  for (const [chainId, addresses] of Object.entries(STABLECOINS)) {
    for (const address of addresses) {
      const normalized = engine.normalizeAddress(address) ?? address;
      const current = expected.get(normalized) ?? new Set();
      current.add(Number(chainId));
      expected.set(normalized, current);
    }
  }
  return expected;
}

function formatChainInfo(info) {
  const kind = info.isContract ? "Contract" : "EOA";
  const token = info.token?.symbol ? ` ${info.token.symbol}` : "";
  return `${info.chainName} (${info.chainId}) ${kind}${token}`;
}

async function run() {
  const expectedChains = buildExpectedChains();
  const addresses = Array.from(expectedChains.keys());
  const chains = engine.resolveChains({
    mode: "workspaceLimited",
    workspaceAllowlist: [1, 10, 42161, 8453, 100],
    userChains: [],
  });

  const cache = new MemoryCache();
  const rpcPool = new engine.RpcPool({
    roundRobin: true,
    cooldownBaseMs: 1000,
    maxRetriesBeforeDisable: 10,
  });
  const pipeline = new engine.EnrichmentPipeline([
    new engine.EoaBasicsEnricher(),
    new engine.ContractBasicsEnricher(),
    new engine.ErcDetectorEnricher(),
  ]);
  const resolver = new engine.AddressResolver({
    cache,
    rpcPool,
    pipeline,
    chains,
    scanMode: "workspaceChains",
  });

  let failures = 0;
  for (const address of addresses) {
    const resolution = await resolver.resolve(address);
    const contractChains = Object.values(resolution.perChain)
      .filter((info) => info.isContract)
      .map((info) => info.chainId);
    const expected = Array.from(expectedChains.get(address) ?? []);
    const missing = expected.filter((chainId) => !contractChains.includes(chainId));

    process.stdout.write(`\n${address}\n`);
    process.stdout.write(`Expected: ${expected.join(", ") || "none"}\n`);
    process.stdout.write(`Contracts: ${contractChains.join(", ") || "none"}\n`);
    const details = Object.values(resolution.perChain).map(formatChainInfo).join(" | ");
    process.stdout.write(`Details: ${details || "no chain data"}\n`);

    if (missing.length > 0) {
      failures += 1;
      process.stdout.write(`Missing contract chains: ${missing.join(", ")}\n`);
    }
  }

  if (failures > 0) {
    process.stderr.write(`\nStablecoin bench failed (${failures} addresses).\n`);
    process.exit(1);
  }

  process.stdout.write("\nStablecoin bench: ok\n");
}

run().catch((error) => {
  console.error("Stablecoin bench failed", error);
  process.exit(1);
});

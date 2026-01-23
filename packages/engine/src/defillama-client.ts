interface PriceCacheEntry {
  price?: number;
  fetchedAt: number;
}

export class DefiLlamaClient {
  private readonly cache = new Map<string, PriceCacheEntry>();

  constructor(private readonly ttlMs = 300_000) {}

  async getPrice(chainKey: string, address: string): Promise<PriceCacheEntry | undefined> {
    const key = `${chainKey}:${address}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached;
    }

    const url = `https://coins.llama.fi/prices/current/${key}`;
    const response = await fetch(url);
    if (!response.ok) {
      return cached;
    }

    const data = (await response.json()) as {
      coins?: Record<string, { price?: number }>;
    };
    const price = data.coins?.[key]?.price;
    const entry: PriceCacheEntry = { price, fetchedAt: Date.now() };
    this.cache.set(key, entry);
    return entry;
  }
}

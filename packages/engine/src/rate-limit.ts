export interface RateLimitConfig {
  maxRequests: number;
  perMs: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private readonly config: RateLimitConfig) {
    this.tokens = config.maxRequests;
    this.lastRefill = Date.now();
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    let attempts = 0;
    while (attempts < 10_000) {
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const now = Date.now();
      this.refill(now);
      if (this.tokens > 0) {
        this.tokens -= 1;
        return;
      }

      const waitMs = this.nextTokenDelay();
      await delay(waitMs, signal);
      attempts += 1;
    }
  }

  private refill(now: number) {
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) {
      return;
    }

    const refillPerMs = this.config.maxRequests / this.config.perMs;
    const tokensToAdd = Math.floor(elapsed * refillPerMs);
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.config.maxRequests, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  private nextTokenDelay() {
    const refillPerMs = this.config.maxRequests / this.config.perMs;
    if (refillPerMs <= 0) {
      return this.config.perMs;
    }
    const ms = Math.ceil((1 / refillPerMs) * 1.05);
    return Math.max(10, ms);
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort);
  });
}

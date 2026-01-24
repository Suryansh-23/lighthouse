import * as vscode from "vscode";

import type { Address, AddressResolution, ChainId } from "@lighthouse/shared";
import { resolveChains, type AddressResolver } from "@lighthouse/engine";

import { extractAddressOccurrences } from "../core/extract";
import { getSettings } from "../core/settings";
import type { CacheStore } from "../data/cache-store";

export class DocumentResolver {
  private readonly inflight = new Set<Address>();
  private readonly queue: Address[] = [];
  private running = 0;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly cache: CacheStore,
    private readonly resolver: AddressResolver,
    private readonly maxConcurrent: number,
  ) {}

  scheduleDocument(doc: vscode.TextDocument) {
    const settings = getSettings();
    if (!settings.enabled) {
      return;
    }
    if (settings.security.respectWorkspaceTrust && !vscode.workspace.isTrusted) {
      return;
    }
    if (doc.uri.scheme !== "file") {
      return;
    }

    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const handle = setTimeout(() => {
      this.timers.delete(key);
      this.queueFromDocument(doc);
    }, 300);
    this.timers.set(key, handle);
  }

  private queueFromDocument(doc: vscode.TextDocument) {
    const settings = getSettings();
    const chainIds = resolveChains(settings.chains).map((chain) => chain.chainId);
    const occurrences = extractAddressOccurrences(doc);
    const seen = new Set<Address>();
    for (const occurrence of occurrences) {
      if (seen.has(occurrence.address)) {
        continue;
      }
      seen.add(occurrence.address);

      const cached = this.cache.get(occurrence.address);
      if (cached && !shouldRefresh(cached, chainIds)) {
        continue;
      }
      if (this.inflight.has(occurrence.address)) {
        continue;
      }
      this.queue.push(occurrence.address);
      this.inflight.add(occurrence.address);
    }

    this.pump();
  }

  private pump() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const address = this.queue.shift();
      if (!address) {
        continue;
      }
      this.running += 1;
      void this.resolver
        .resolve(address)
        .catch(() => undefined)
        .finally(() => {
          this.running -= 1;
          this.inflight.delete(address);
          this.pump();
        });
    }
  }
}

function shouldRefresh(resolution: AddressResolution, chainIds: ChainId[]): boolean {
  if (resolution.scan.chainsFailed.length > 0) {
    return true;
  }
  return chainIds.some((chainId) => !resolution.perChain[chainId]);
}

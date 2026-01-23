import * as vscode from "vscode";

import type { Address, AddressResolution } from "@lighthouse/shared";

interface CacheEntry {
  value: AddressResolution;
  expiresAt: number;
}

interface CacheFileShape {
  entries: Record<string, CacheEntry>;
}

export class CacheStore {
  private readonly ttlMs: number;
  private readonly storageUri?: vscode.Uri;
  private readonly fileUri?: vscode.Uri;
  private readonly entries = new Map<Address, CacheEntry>();

  constructor(context: vscode.ExtensionContext, ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
    this.storageUri = context.storageUri ?? undefined;
    this.fileUri = this.storageUri
      ? vscode.Uri.joinPath(this.storageUri, "cache.json")
      : undefined;
  }

  async init(): Promise<void> {
    if (!this.fileUri) {
      return;
    }

    if (this.storageUri) {
      await vscode.workspace.fs.createDirectory(this.storageUri);
    }

    try {
      const raw = await vscode.workspace.fs.readFile(this.fileUri);
      const text = Buffer.from(raw).toString("utf8");
      const parsed = JSON.parse(text) as CacheFileShape;
      for (const [address, entry] of Object.entries(parsed.entries ?? {})) {
        this.entries.set(address as Address, entry);
      }
    } catch {
      // Ignore missing or invalid cache files.
    }
  }

  get(address: Address): AddressResolution | undefined {
    const entry = this.entries.get(address);
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(address);
      return undefined;
    }

    return entry.value;
  }

  async set(address: Address, value: AddressResolution): Promise<void> {
    this.entries.set(address, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });

    await this.persist();
  }

  async clear(): Promise<void> {
    this.entries.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.fileUri) {
      return;
    }

    const entries: Record<string, CacheEntry> = {};
    for (const [address, entry] of this.entries.entries()) {
      entries[address] = entry;
    }

    const payload: CacheFileShape = { entries };
    const encoded = Buffer.from(JSON.stringify(payload, null, 2));
    await vscode.workspace.fs.writeFile(this.fileUri, encoded);
  }
}

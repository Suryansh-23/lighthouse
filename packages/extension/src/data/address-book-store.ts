import * as vscode from "vscode";

import type { Address, AddressBookEntry, OccurrenceRef } from "@lighthouse/shared";

interface AddressBookFile {
  pinned: Record<string, AddressBookEntry>;
  notesByAddress: Record<string, string>;
  occurrencesByAddress: Record<string, OccurrenceRef[]>;
  addressesByUri: Record<string, Address[]>;
}

export class AddressBookStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private readonly storageUri?: vscode.Uri;
  private readonly fileUri?: vscode.Uri;
  private readonly pinned = new Map<Address, AddressBookEntry>();
  private readonly notesByAddress = new Map<Address, string>();
  private readonly occurrencesByAddress = new Map<Address, OccurrenceRef[]>();
  private readonly addressesByUri = new Map<string, Address[]>();

  constructor(context: vscode.ExtensionContext) {
    this.storageUri = context.storageUri ?? undefined;
    this.fileUri = this.storageUri
      ? vscode.Uri.joinPath(this.storageUri, "address-book.json")
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
      const parsed = JSON.parse(text) as AddressBookFile;

      for (const [address, entry] of Object.entries(parsed.pinned ?? {})) {
        this.pinned.set(address as Address, entry);
      }

      for (const [address, notes] of Object.entries(parsed.notesByAddress ?? {})) {
        this.notesByAddress.set(address as Address, notes);
      }

      for (const [address, occurrences] of Object.entries(parsed.occurrencesByAddress ?? {})) {
        this.occurrencesByAddress.set(address as Address, occurrences);
      }

      for (const [uri, addresses] of Object.entries(parsed.addressesByUri ?? {})) {
        this.addressesByUri.set(uri, addresses as Address[]);
      }
    } catch {
      // Ignore missing or invalid state.
    }
  }

  getPinnedEntries(): AddressBookEntry[] {
    return Array.from(this.pinned.values()).sort((a, b) => a.address.localeCompare(b.address));
  }

  getPinnedEntry(address: Address): AddressBookEntry | undefined {
    return this.pinned.get(address);
  }

  getIndexedAddresses(): Address[] {
    return Array.from(this.occurrencesByAddress.keys()).sort((a, b) => a.localeCompare(b));
  }

  getOccurrences(address: Address): OccurrenceRef[] {
    return this.occurrencesByAddress.get(address) ?? [];
  }

  getAddressesForUri(uri: string): Address[] {
    return this.addressesByUri.get(uri) ?? [];
  }

  getNotes(address: Address): string | undefined {
    return this.pinned.get(address)?.notes ?? this.notesByAddress.get(address);
  }

  isPinned(address: Address): boolean {
    return this.pinned.has(address);
  }

  async addPinned(address: Address, label?: string): Promise<void> {
    const now = new Date().toISOString();
    const entry: AddressBookEntry = {
      address,
      label,
      notes: this.notesByAddress.get(address),
      createdAt: now,
      updatedAt: now,
      pinned: true,
    };

    this.pinned.set(address, entry);
    await this.persist();
    this.emitter.fire();
  }

  async removePinned(address: Address): Promise<void> {
    if (!this.pinned.delete(address)) {
      return;
    }

    await this.persist();
    this.emitter.fire();
  }

  async updateOccurrences(uri: string, occurrencesByAddress: Map<Address, OccurrenceRef[]>): Promise<void> {
    const previousAddresses = this.addressesByUri.get(uri) ?? [];

    for (const address of previousAddresses) {
      const existing = this.occurrencesByAddress.get(address) ?? [];
      const filtered = existing.filter(occurrence => occurrence.uri !== uri);
      if (filtered.length === 0) {
        this.occurrencesByAddress.delete(address);
      } else {
        this.occurrencesByAddress.set(address, filtered);
      }
    }

    const nextAddresses = Array.from(occurrencesByAddress.keys());
    if (nextAddresses.length === 0) {
      this.addressesByUri.delete(uri);
    } else {
      this.addressesByUri.set(uri, nextAddresses);
    }

    for (const [address, occurrences] of occurrencesByAddress.entries()) {
      const existing = this.occurrencesByAddress.get(address) ?? [];
      this.occurrencesByAddress.set(address, [...existing, ...occurrences]);
    }

    await this.persist();
    this.emitter.fire();
  }

  async setNotes(address: Address, notes: string): Promise<void> {
    if (!notes) {
      this.notesByAddress.delete(address);
    } else {
      this.notesByAddress.set(address, notes);
    }

    const existing = this.pinned.get(address);
    if (existing) {
      this.pinned.set(address, {
        ...existing,
        notes: notes || undefined,
        updatedAt: new Date().toISOString(),
      });
    }

    await this.persist();
    this.emitter.fire();
  }

  private async persist(): Promise<void> {
    if (!this.fileUri) {
      return;
    }

    const pinned: Record<string, AddressBookEntry> = {};
    for (const [address, entry] of this.pinned.entries()) {
      pinned[address] = entry;
    }

    const notesByAddress: Record<string, string> = {};
    for (const [address, notes] of this.notesByAddress.entries()) {
      if (notes) {
        notesByAddress[address] = notes;
      }
    }

    const occurrencesByAddress: Record<string, OccurrenceRef[]> = {};
    for (const [address, occurrences] of this.occurrencesByAddress.entries()) {
      occurrencesByAddress[address] = occurrences;
    }

    const addressesByUri: Record<string, Address[]> = {};
    for (const [uri, addresses] of this.addressesByUri.entries()) {
      addressesByUri[uri] = addresses;
    }

    const payload: AddressBookFile = {
      pinned,
      notesByAddress,
      occurrencesByAddress,
      addressesByUri,
    };

    const encoded = Buffer.from(JSON.stringify(payload, null, 2));
    await vscode.workspace.fs.writeFile(this.fileUri, encoded);
  }
}

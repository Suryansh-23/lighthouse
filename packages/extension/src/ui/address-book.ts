import * as vscode from "vscode";

import type { AddressBookEntry } from "@lighthouse/shared";

import type { AddressBookStore } from "../data/address-book-store";

type RootKind = "pinned" | "indexed";

class AddressBookItem extends vscode.TreeItem {
  constructor(
    public readonly kind: RootKind | "entry",
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly entry?: AddressBookEntry,
  ) {
    super(label, collapsibleState);
  }
}

export class AddressBookProvider implements vscode.TreeDataProvider<AddressBookItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: AddressBookStore) {
    this.store.onDidChange(() => this.refresh());
  }

  refresh() {
    this.emitter.fire();
  }

  getTreeItem(element: AddressBookItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AddressBookItem): AddressBookItem[] {
    if (!element) {
      return [
        new AddressBookItem("pinned", "Pinned", vscode.TreeItemCollapsibleState.Expanded),
        new AddressBookItem("indexed", "Indexed", vscode.TreeItemCollapsibleState.Collapsed),
      ];
    }

    if (element.kind === "pinned") {
      return this.store.getPinnedEntries().map(entry => this.toEntryItem(entry));
    }

    if (element.kind === "indexed") {
      const pinned = new Set(this.store.getPinnedEntries().map(entry => entry.address));
      return this.store
        .getIndexedAddresses()
        .filter(address => !pinned.has(address))
        .map(address =>
          this.toEntryItem({
            address,
            createdAt: "",
            updatedAt: "",
            pinned: false,
          }),
        );
    }

    return [];
  }

  private toEntryItem(entry: AddressBookEntry): AddressBookItem {
    const label = entry.label ? `${entry.label} (${entry.address})` : entry.address;
    const item = new AddressBookItem(
      "entry",
      label,
      vscode.TreeItemCollapsibleState.None,
      entry,
    );
    item.contextValue = entry.pinned ? "lighthousePinnedAddress" : "lighthouseIndexedAddress";
    item.command = {
      command: "lighthouse.openExplorer",
      title: "Open Explorer",
      arguments: [{ address: entry.address }],
    };
    return item;
  }
}

export function registerAddressBookView(
  context: vscode.ExtensionContext,
  store: AddressBookStore,
): AddressBookProvider {
  const provider = new AddressBookProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("lighthouseAddressBook", provider),
  );
  return provider;
}

import * as vscode from "vscode";

import type { AddressBookEntry } from "@lighthouse/shared";

import type { AddressBookStore } from "../data/address-book-store";
import type { CacheStore } from "../data/cache-store";
import type { AddressResolver } from "@lighthouse/engine";
import { selectPrimaryChain } from "./chain-selection";

type RootKind = "pinned" | "indexed";
type ItemKind = RootKind | "entry" | "detail";

class AddressBookItem extends vscode.TreeItem {
  constructor(
    public readonly kind: ItemKind,
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

  constructor(
    private readonly store: AddressBookStore,
    private readonly cache: CacheStore,
    private readonly resolver: AddressResolver,
  ) {
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
      const pinnedCount = this.store.getPinnedEntries().length;
      const indexedCount = this.store.getIndexedAddresses().length;
      return [
        this.decorateRoot(
          new AddressBookItem("pinned", "Pinned", vscode.TreeItemCollapsibleState.Expanded),
          "pin",
          pinnedCount,
        ),
        this.decorateRoot(
          new AddressBookItem("indexed", "Indexed", vscode.TreeItemCollapsibleState.Collapsed),
          "list-unordered",
          indexedCount,
        ),
      ];
    }

    if (element.kind === "pinned") {
      return this.store.getPinnedEntries().map(entry => this.toEntryItem(entry, true));
    }

    if (element.kind === "indexed") {
      const pinned = new Set(this.store.getPinnedEntries().map(entry => entry.address));
      return this.store
        .getIndexedAddresses()
        .filter(address => !pinned.has(address))
        .map(address =>
          this.toEntryItem(
            {
              address,
              createdAt: "",
              updatedAt: "",
              pinned: false,
            },
            false,
          ),
        );
    }

    if (element.kind === "entry" && element.entry) {
      return this.buildDetailItems(element.entry);
    }

    return [];
  }

  private toEntryItem(entry: AddressBookEntry, pinned: boolean): AddressBookItem {
    const label = entry.label || entry.address;
    const description = entry.label ? entry.address : undefined;
    const item = new AddressBookItem(
      "entry",
      label,
      vscode.TreeItemCollapsibleState.Collapsed,
      entry,
    );
    item.description = description;
    item.contextValue = pinned ? "lighthousePinnedAddress" : "lighthouseIndexedAddress";
    item.iconPath = new vscode.ThemeIcon(pinned ? "pin" : "circle-outline");
    item.command = {
      command: "lighthouse.openExplorer",
      title: "Open Explorer",
      arguments: [{ address: entry.address }],
    };
    return item;
  }

  private decorateRoot(
    item: AddressBookItem,
    icon: string,
    count: number,
  ): AddressBookItem {
    item.iconPath = new vscode.ThemeIcon(icon);
    item.description = String(count);
    return item;
  }

  private buildDetailItems(entry: AddressBookEntry): AddressBookItem[] {
    const resolution = this.cache.get(entry.address);
    if (!resolution) {
      return [
        new AddressBookItem(
          "detail",
          "Resolve details",
          vscode.TreeItemCollapsibleState.None,
          entry,
        ),
      ];
    }

    const info = selectPrimaryChain(resolution);
    const items: AddressBookItem[] = [];
    if (info) {
      items.push(
        new AddressBookItem(
          "detail",
          `${info.chainName} (${info.chainId}) · ${info.kind}`,
          vscode.TreeItemCollapsibleState.None,
          entry,
        ),
      );
      if (info.contract?.classification?.type) {
        items.push(
          new AddressBookItem(
            "detail",
            `Type: ${info.contract.classification.type}`,
            vscode.TreeItemCollapsibleState.None,
            entry,
          ),
        );
      }
      if (info.token?.symbol) {
        items.push(
          new AddressBookItem(
            "detail",
            `Token: ${info.token.symbol}`,
            vscode.TreeItemCollapsibleState.None,
            entry,
          ),
        );
      }
    }

    const notes = this.store.getNotes(entry.address);
    if (notes) {
      items.push(
        new AddressBookItem(
          "detail",
          `Notes: ${notes.length > 40 ? `${notes.slice(0, 40)}…` : notes}`,
          vscode.TreeItemCollapsibleState.None,
          entry,
        ),
      );
    }

    return items;
  }
}

export function registerAddressBookView(
  context: vscode.ExtensionContext,
  store: AddressBookStore,
  cache: CacheStore,
  resolver: AddressResolver,
): AddressBookProvider {
  const provider = new AddressBookProvider(store, cache, resolver);
  const view = vscode.window.createTreeView("lighthouseAddressBook", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);
  context.subscriptions.push(
    view.onDidExpandElement(async event => {
      if (event.element.kind === "entry" && event.element.entry) {
        await resolver.resolve(event.element.entry.address).catch(() => undefined);
        provider.refresh();
      }
    }),
  );
  return provider;
}

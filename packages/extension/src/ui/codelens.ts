import * as vscode from "vscode";

import type { Address, AddressResolution } from "@lighthouse/shared";

import { extractAddressOccurrences } from "../core/extract";
import { getSettings } from "../core/settings";
import type { AddressBookStore } from "../data/address-book-store";
import type { CacheStore } from "../data/cache-store";
import { selectPrimaryChain } from "./chain-selection";

interface CodeLensDeps {
  cache: CacheStore;
  addressBook: AddressBookStore;
}

export function registerCodeLens(context: vscode.ExtensionContext, deps: CodeLensDeps) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, {
      provideCodeLenses: doc => {
        const settings = getSettings();
        if (!settings.enabled || !settings.ui.codelens.enabled) {
          return [];
        }

        const occurrences = extractAddressOccurrences(doc);
        const lenses: vscode.CodeLens[] = [];

        for (const occurrence of occurrences) {
          const cached = deps.cache.get(occurrence.address);
          const label = deps.addressBook.getPinnedEntry(occurrence.address)?.label;
          const summary = buildSummary(occurrence.address, cached, label);
          const baseArgs = { address: occurrence.address };
          const openArgs = {
            address: occurrence.address,
            chainId: cached?.scan.chainsSucceeded[0] ?? cached?.scan.chainsAttempted[0],
          };

          lenses.push(
            new vscode.CodeLens(occurrence.range, {
              title: summary,
              command: "lighthouse.openExplorer",
              arguments: [openArgs],
            }),
          );

          lenses.push(
            new vscode.CodeLens(occurrence.range, {
              title: "Open",
              command: "lighthouse.openExplorer",
              arguments: [openArgs],
            }),
          );

          lenses.push(
            new vscode.CodeLens(occurrence.range, {
              title: "Copy",
              command: "lighthouse.copyAddress",
              arguments: [baseArgs],
            }),
          );

          lenses.push(
            new vscode.CodeLens(occurrence.range, {
              title: "Inspect",
              command: "lighthouse.inspectAddress",
              arguments: [baseArgs],
            }),
          );

          lenses.push(
            new vscode.CodeLens(occurrence.range, {
              title: "Add",
              command: "lighthouse.addToAddressBook",
              arguments: [baseArgs],
            }),
          );
        }

        return lenses;
      },
    }),
  );
}

function buildSummary(address: Address, resolution?: AddressResolution, label?: string): string {
  if (!resolution) {
    return label ? `${label} · Resolving` : `Resolving ${address.slice(0, 10)}…`;
  }

  const info = selectPrimaryChain(resolution);
  if (!info) {
    return `Unknown chain · ${address.slice(0, 10)}…`;
  }

  const kind = info.kind === "Unknown" ? "Unknown" : info.kind;
  const classification = info.contract?.classification?.type;
  if (classification) {
    const tokenLabel = info.token?.symbol ? `${classification} (${info.token.symbol})` : classification;
    return withLabel(`${info.chainName} (${info.chainId}): ${kind} · ${tokenLabel}`, label);
  }

  return withLabel(`${info.chainName} (${info.chainId}): ${kind}`, label);
}

function withLabel(value: string, label?: string): string {
  if (!label) {
    return value;
  }
  const trimmed = label.length > 18 ? `${label.slice(0, 18)}…` : label;
  return `${trimmed} · ${value}`;
}

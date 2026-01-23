import * as vscode from "vscode";

import type { Address, AddressResolution, ChainAddressInfo } from "@lighthouse/shared";

import { extractAddressOccurrences } from "../core/extract";
import { getSettings } from "../core/settings";
import type { CacheStore } from "../data/cache-store";

interface CodeLensDeps {
  cache: CacheStore;
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
          const summary = buildSummary(occurrence.address, cached);
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

function buildSummary(address: Address, resolution?: AddressResolution): string {
  if (!resolution) {
    return `Resolving ${address.slice(0, 10)}…`;
  }

  const info = pickPrimaryChain(resolution);
  if (!info) {
    return `Unknown chain · ${address.slice(0, 10)}…`;
  }

  const kind = info.kind === "Unknown" ? "Unknown" : info.kind;
  return `${info.chainName} (${info.chainId}): ${kind}`;
}

function pickPrimaryChain(resolution: AddressResolution): ChainAddressInfo | undefined {
  const chainId = resolution.scan.chainsSucceeded[0] ?? resolution.scan.chainsAttempted[0];
  if (!chainId) {
    return undefined;
  }

  return resolution.perChain[chainId];
}

// Commands accept object arguments directly.

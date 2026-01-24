import * as vscode from "vscode";

import type { Address, AddressBookEntry, AddressResolution, ChainId } from "@lighthouse/shared";

import { buildExplorerUrl, getChainById, resolveChains } from "@lighthouse/engine";

import { getSettings } from "../core/settings";
import type { AddressBookStore } from "../data/address-book-store";
import type { CacheStore } from "../data/cache-store";
import type { WorkspaceIndexer } from "../domain/indexer";
import type { AddressResolver, ExplorerClient, ExplorerKind } from "@lighthouse/engine";
import { hasMultipleCandidateChains, promptForChain } from "./chain-selection";

interface AddressCommandArgs {
  address: Address;
  chainId?: ChainId;
}

interface CommandDeps {
  cache: CacheStore;
  addressBook: AddressBookStore;
  indexer: WorkspaceIndexer;
  explorerClient: ExplorerClient;
  secrets: vscode.SecretStorage;
  resolver: AddressResolver;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps) {
  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.copyAddress", async (args: AddressCommandArgs) => {
      const address = getAddressFromArgs(args);
      if (!address) {
        return;
      }
      await vscode.env.clipboard.writeText(address);
      void vscode.window.showInformationMessage("Lighthouse: Address copied.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.openExplorer", async (args: AddressCommandArgs) => {
      const address = getAddressFromArgs(args);
      if (!address) {
        return;
      }

      const settings = getSettings();
      const cached = deps.cache.get(address);
      const resolved = cached ?? (await resolveAddress(deps, address));
      const chainInfo = await selectChain(resolved);
      if (resolved && hasMultipleCandidateChains(resolved) && !chainInfo) {
        return;
      }
      const chain = chainInfo
        ? getChainById(chainInfo.chainId, settings.chains)
        : resolveChains(settings.chains)[0];
      const url = buildExplorerUrl(address, chain, settings.explorer.default);
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.addToAddressBook",
      async (args: AddressCommandArgs) => {
        const address = getAddressFromArgs(args);
        if (!address) {
          return;
        }

        const label = await vscode.window.showInputBox({
          title: "Lighthouse: Add Address",
          prompt: "Optional label",
          value: "",
        });
        if (label === undefined) {
          return;
        }
        await deps.addressBook.addPinned(address, label || undefined);
        void vscode.window.showInformationMessage("Lighthouse: Address pinned.");
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.removeFromAddressBook",
      async (args: AddressCommandArgs) => {
        const address = getAddressFromArgs(args);
        if (!address) {
          return;
        }

        await deps.addressBook.removePinned(address);
        void vscode.window.showInformationMessage("Lighthouse: Address removed.");
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.reindexWorkspace", async () => {
      await deps.indexer.scanWorkspace();
      void vscode.window.showInformationMessage("Lighthouse: Workspace indexed.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.clearCache", async () => {
      await deps.cache.clear();
      await deps.addressBook.clear();
      void vscode.window.showInformationMessage("Lighthouse: Cache and address book cleared.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.setExplorerApiKey", async () => {
      const options: { label: string; value: ExplorerKind }[] = [
        { label: "Routescan", value: "routescan" },
        { label: "Etherscan", value: "etherscan" },
        { label: "Blockscout", value: "blockscout" },
      ];
      const explorer = await vscode.window.showQuickPick(options, {
        placeHolder: "Select explorer provider",
      });

      if (!explorer) {
        return;
      }

      const apiKey = await vscode.window.showInputBox({
        title: `Lighthouse: ${explorer.label} API Key`,
        prompt: "Enter your API key (leave blank to clear).",
        ignoreFocusOut: true,
      });

      if (apiKey === undefined) {
        return;
      }

      const secretKey = `lighthouse.explorerApiKey.${explorer.value}`;
      const config = vscode.workspace.getConfiguration("lighthouse");
      if (!apiKey) {
        await deps.secrets.delete(secretKey);
        await config.update(
          `explorer.apiKeys.${explorer.value}`,
          "",
          vscode.ConfigurationTarget.Global,
        );
        deps.explorerClient.setApiKey(explorer.value, undefined);
        void vscode.window.showInformationMessage("Explorer API key cleared.");
        return;
      }

      await deps.secrets.store(secretKey, apiKey);
      await config.update(
        `explorer.apiKeys.${explorer.value}`,
        apiKey,
        vscode.ConfigurationTarget.Global,
      );
      deps.explorerClient.setApiKey(explorer.value, apiKey);
      void vscode.window.showInformationMessage("Explorer API key saved.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.revealOccurrences",
      async (args: AddressCommandArgs) => {
        const address = getAddressFromArgs(args);
        if (!address) {
          return;
        }

        const occurrences = deps.addressBook.getOccurrences(address);
        if (occurrences.length === 0) {
          void vscode.window.showInformationMessage("Lighthouse: No occurrences found.");
          return;
        }

        const pick = await vscode.window.showQuickPick(
          occurrences.map((occurrence) => ({
            label: `${occurrence.uri}`,
            description: `Line ${occurrence.range.start.line + 1}`,
            occurrence,
          })),
          { placeHolder: "Select occurrence to reveal" },
        );

        if (!pick) {
          return;
        }

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(pick.occurrence.uri));
        const editor = await vscode.window.showTextDocument(doc);
        const start = new vscode.Position(
          pick.occurrence.range.start.line,
          pick.occurrence.range.start.char,
        );
        const end = new vscode.Position(
          pick.occurrence.range.end.line,
          pick.occurrence.range.end.char,
        );
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end));
      },
    ),
  );
}

function getAddressFromArgs(
  args: AddressCommandArgs | { entry?: AddressBookEntry } | undefined,
): Address | undefined {
  if (!args) {
    return undefined;
  }

  if ((args as AddressCommandArgs).address) {
    return (args as AddressCommandArgs).address;
  }

  const entry = (args as { entry?: AddressBookEntry }).entry;
  return entry?.address;
}

async function resolveAddress(deps: CommandDeps, address: Address) {
  return deps.resolver.resolve(address).catch(() => undefined);
}

async function selectChain(cached?: AddressResolution) {
  if (!cached) {
    return undefined;
  }

  const selected = await promptForChain(cached, "Select chain to open explorer");
  if (selected) {
    return selected;
  }

  if (hasMultipleCandidateChains(cached)) {
    return undefined;
  }

  return cached.scan.chainsSucceeded[0]
    ? cached.perChain[cached.scan.chainsSucceeded[0]]
    : cached.scan.chainsAttempted[0]
      ? cached.perChain[cached.scan.chainsAttempted[0]]
      : undefined;
}

import * as vscode from "vscode";

import type { Address, ChainId } from "@lighthouse/shared";

import { buildExplorerUrl, getChainById, resolveChains } from "@lighthouse/engine";
import { getSettings } from "../core/settings";
import type { AddressBookStore } from "../data/address-book-store";
import type { CacheStore } from "../data/cache-store";
import type { WorkspaceIndexer } from "../domain/indexer";
import type { ExplorerClient } from "@lighthouse/engine";

import type { InspectorController } from "./inspector";

interface AddressCommandArgs {
  address: Address;
  chainId?: ChainId;
}

interface CommandDeps {
  cache: CacheStore;
  addressBook: AddressBookStore;
  indexer: WorkspaceIndexer;
  inspector: InspectorController;
  explorerClient: ExplorerClient;
  secrets: vscode.SecretStorage;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps) {
  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.copyAddress", async (args: AddressCommandArgs) => {
      if (!args?.address) {
        return;
      }
      await vscode.env.clipboard.writeText(args.address);
      void vscode.window.showInformationMessage("Lighthouse: Address copied.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.openExplorer", async (args: AddressCommandArgs) => {
      if (!args?.address) {
        return;
      }

      const settings = getSettings();
      const cached = deps.cache.get(args.address);
      const chainId =
        args.chainId ??
        cached?.scan.chainsSucceeded[0] ??
        cached?.scan.chainsAttempted[0];
      const chain = chainId
        ? getChainById(chainId, settings.chains)
        : resolveChains(settings.chains)[0];
      const url = buildExplorerUrl(args.address, chain, settings.explorer.default);
      const target = vscode.Uri.parse(url);

      if (settings.explorer.openInExternalBrowser) {
        await vscode.env.openExternal(target);
      } else {
        await vscode.commands.executeCommand("vscode.open", target);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.addToAddressBook",
      async (args: AddressCommandArgs) => {
        if (!args?.address) {
          return;
        }

        const label = await vscode.window.showInputBox({
          title: "Lighthouse: Add Address",
          prompt: "Optional label",
          value: "",
        });
        await deps.addressBook.addPinned(args.address, label || undefined);
        void vscode.window.showInformationMessage("Lighthouse: Address pinned.");
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.removeFromAddressBook",
      async (args: AddressCommandArgs) => {
        if (!args?.address) {
          return;
        }

        await deps.addressBook.removePinned(args.address);
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
      void vscode.window.showInformationMessage("Lighthouse: Cache cleared.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lighthouse.setExplorerApiKey", async () => {
      const apiKey = await vscode.window.showInputBox({
        title: "Lighthouse: Set Explorer API Key",
        prompt: "Enter your explorer API key (leave blank to clear).",
        ignoreFocusOut: true,
      });

      if (apiKey === undefined) {
        return;
      }

      if (!apiKey) {
        await deps.secrets.delete("lighthouse.explorerApiKey");
        deps.explorerClient.setApiKey(undefined);
        void vscode.window.showInformationMessage("Lighthouse: Explorer API key cleared.");
        return;
      }

      await deps.secrets.store("lighthouse.explorerApiKey", apiKey);
      deps.explorerClient.setApiKey(apiKey);
      void vscode.window.showInformationMessage("Lighthouse: Explorer API key saved.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.revealOccurrences",
      async (args: AddressCommandArgs) => {
        if (!args?.address) {
          return;
        }

        const occurrences = deps.addressBook.getOccurrences(args.address);
        if (occurrences.length === 0) {
          void vscode.window.showInformationMessage("Lighthouse: No occurrences found.");
          return;
        }

        const pick = await vscode.window.showQuickPick(
          occurrences.map(occurrence => ({
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

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.inspectAddress",
      async (args?: AddressCommandArgs) => {
        await deps.inspector.open(args);
      },
    ),
  );
}

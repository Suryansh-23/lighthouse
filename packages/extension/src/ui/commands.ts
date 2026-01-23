import * as vscode from "vscode";

import type { Address, ChainId } from "@lighthouse/shared";

import { getChainById, resolveChains } from "../core/chain-config";
import { buildExplorerUrl } from "../core/explorer";
import { getSettings } from "../core/settings";
import { CacheStore } from "../data/cache-store";

interface AddressCommandArgs {
  address: Address;
  chainId?: ChainId;
}

interface CommandDeps {
  cache: CacheStore;
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
        ? getChainById(chainId, settings)
        : resolveChains(settings)[0];
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

        void vscode.window.showInformationMessage(
          "Lighthouse: Address book support is coming soon.",
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "lighthouse.inspectAddress",
      async (args?: AddressCommandArgs) => {
        if (args?.address) {
          void vscode.window.showInformationMessage(
            `Lighthouse: Inspector for ${args.address} is not implemented yet.`,
          );
          return;
        }

        void vscode.window.showInformationMessage(
          "Lighthouse: Inspect Address is not implemented yet.",
        );
      },
    ),
  );
}

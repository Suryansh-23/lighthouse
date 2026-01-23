import * as vscode from "vscode";

import type { AddressResolution, ChainAddressInfo } from "@lighthouse/shared";

import { extractAddressAtPosition } from "../core/extract";
import { getSettings } from "../core/settings";
import { CacheStore } from "../data/cache-store";
import type { AddressResolver } from "../domain/resolve";

interface HoverDeps {
  cache: CacheStore;
  resolver: AddressResolver;
}

export function registerHover(context: vscode.ExtensionContext, deps: HoverDeps) {
  const selector: vscode.DocumentSelector = [
    { scheme: "file" },
    { scheme: "vscode-remote" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover: async (doc, pos, token) => {
        const settings = getSettings();
        if (!settings.enabled || !settings.ui.hover.enabled) {
          return undefined;
        }

        const hit = extractAddressAtPosition(doc, pos);
        if (!hit) {
          return undefined;
        }

        const cached = deps.cache.get(hit.address);
        const md = buildHoverMarkdown(hit.address, cached);
        const hover = new vscode.Hover(md, hit.range);

        if (!cached) {
          void deps.resolver.resolve(hit.address, { token }).catch(() => undefined);
        }

        return hover;
      },
    }),
  );
}

function buildHoverMarkdown(address: string, resolution?: AddressResolution): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.supportThemeIcons = true;
  md.isTrusted = {
    enabledCommands: [
      "lighthouse.openExplorer",
      "lighthouse.copyAddress",
      "lighthouse.addToAddressBook",
      "lighthouse.inspectAddress",
    ],
  };

  md.appendMarkdown("**Lighthouse**\n\n");
  md.appendMarkdown(`\`${address}\`\n\n`);

  if (resolution) {
    const info = pickPrimaryChain(resolution);
    if (info) {
      const kind = info.kind === "Unknown" ? "Unknown" : info.kind;
      md.appendMarkdown(`${info.chainName} (${info.chainId}) · ${kind}\n\n`);
    }
  } else {
    md.appendMarkdown("Resolving…\n\n");
  }

  const args = encodeCommandArgs({ address });
  const openArgs = encodeCommandArgs({
    address,
    chainId: resolution?.scan.chainsSucceeded[0] ?? resolution?.scan.chainsAttempted[0],
  });

  md.appendMarkdown(
    `[Open Explorer](command:lighthouse.openExplorer?${openArgs}) | ` +
      `[Copy](command:lighthouse.copyAddress?${args}) | ` +
      `[Inspect](command:lighthouse.inspectAddress?${args}) | ` +
      `[Add](command:lighthouse.addToAddressBook?${args})`,
  );

  return md;
}

function pickPrimaryChain(resolution: AddressResolution): ChainAddressInfo | undefined {
  const chainId =
    resolution.scan.chainsSucceeded[0] ??
    resolution.scan.chainsAttempted[0];
  if (!chainId) {
    return undefined;
  }

  return resolution.perChain[chainId];
}

function encodeCommandArgs(args: { address: string; chainId?: number }): string {
  return encodeURIComponent(JSON.stringify(args));
}

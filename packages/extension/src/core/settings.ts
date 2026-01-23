import * as vscode from "vscode";

import type { ChainId } from "@lighthouse/shared";

import type { ChainConfig, ExplorerKind } from "./chains";

export type ChainMode = "workspaceLimited" | "userAll" | "singleChain";

export interface LighthouseSettings {
  enabled: boolean;
  ui: {
    hover: { enabled: boolean };
  };
  chains: {
    mode: ChainMode;
    workspaceAllowlist: ChainId[];
    userChains: ChainConfig[];
  };
  explorer: {
    default: ExplorerKind;
    openInExternalBrowser: boolean;
  };
  cache: {
    ttlSeconds: number;
  };
}

export function getSettings(): LighthouseSettings {
  const config = vscode.workspace.getConfiguration("lighthouse");
  return {
    enabled: config.get("enabled", true),
    ui: {
      hover: {
        enabled: config.get("ui.hover.enabled", true),
      },
    },
    chains: {
      mode: config.get("chains.mode", "workspaceLimited"),
      workspaceAllowlist: config.get("chains.workspaceAllowlist", [
        1,
        10,
        137,
        42161,
        8453,
      ]),
      userChains: config.get("chains.userChains", []),
    },
    explorer: {
      default: config.get("explorer.default", "routescan"),
      openInExternalBrowser: config.get("explorer.openInExternalBrowser", true),
    },
    cache: {
      ttlSeconds: config.get("cache.ttlSeconds", 60 * 60 * 24),
    },
  };
}

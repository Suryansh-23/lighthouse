import * as vscode from "vscode";

import { getSettings } from "./core/settings";
import { CacheStore } from "./data/cache-store";
import { AddressResolver } from "./domain/resolve";
import { registerCommands } from "./ui/commands";
import { registerHover } from "./ui/hover";

export async function activate(context: vscode.ExtensionContext) {
  const settings = getSettings();
  if (!settings.enabled) {
    return;
  }

  const cache = new CacheStore(context, settings.cache.ttlSeconds);
  await cache.init();

  const resolver = new AddressResolver(cache);

  registerCommands(context, { cache });
  registerHover(context, { cache, resolver });
}

export function deactivate() {
  return undefined;
}

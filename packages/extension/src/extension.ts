import * as vscode from "vscode";

import { getSettings } from "./core/settings";
import { CacheStore } from "./data/cache-store";
import { AddressBookStore } from "./data/address-book-store";
import { DefiLlamaClient } from "./data/defillama-client";
import { ExplorerClient } from "./data/explorer-client";
import { RpcPool } from "./data/rpc-pool";
import { EnrichmentPipeline } from "./domain/enrichment";
import { ContractBasicsEnricher } from "./domain/enrichers/contract-basics";
import { DefiLlamaPriceEnricher } from "./domain/enrichers/defillama-price";
import { EoaBasicsEnricher } from "./domain/enrichers/eoa-basics";
import { ErcDetectorEnricher } from "./domain/enrichers/erc-detector";
import { ExplorerMetadataEnricher } from "./domain/enrichers/explorer-metadata";
import { WorkspaceIndexer } from "./domain/indexer";
import { AddressResolver } from "./domain/resolve";
import { registerAddressBookView } from "./ui/address-book";
import { registerCodeLens } from "./ui/codelens";
import { registerCommands } from "./ui/commands";
import { registerHover } from "./ui/hover";
import { InspectorController } from "./ui/inspector";

export async function activate(context: vscode.ExtensionContext) {
  const settings = getSettings();
  if (!settings.enabled) {
    return;
  }

  const cache = new CacheStore(context, settings.cache.ttlSeconds);
  await cache.init();

  const addressBook = new AddressBookStore(context);
  await addressBook.init();

  const rpcPool = new RpcPool(settings);
  const explorerClient = new ExplorerClient(context.secrets);
  const defillamaClient = new DefiLlamaClient();
  const pipeline = new EnrichmentPipeline([
    new EoaBasicsEnricher(),
    new ContractBasicsEnricher(),
    new ErcDetectorEnricher(),
    new ExplorerMetadataEnricher(explorerClient),
    new DefiLlamaPriceEnricher(defillamaClient),
  ]);
  const resolver = new AddressResolver(cache, rpcPool, pipeline);
  const inspector = new InspectorController(context, { cache, resolver, addressBook });
  const indexer = new WorkspaceIndexer(addressBook);

  registerCommands(context, { cache, addressBook, indexer, inspector });
  registerHover(context, { cache, resolver });
  registerCodeLens(context, { cache });
  registerAddressBookView(context, addressBook);

  if (!settings.security.respectWorkspaceTrust || vscode.workspace.isTrusted) {
    void indexer.scanWorkspace();
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      void indexer.scanDocument(doc);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      void indexer.scanDocument(doc);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void indexer.scanWorkspace();
    }),
  );
}

export function deactivate() {
  return undefined;
}

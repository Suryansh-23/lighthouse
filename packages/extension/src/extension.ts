import * as vscode from "vscode";

import { getSettings } from "./core/settings";
import {
  AddressResolver,
  ContractBasicsEnricher,
  DefiLlamaClient,
  DefiLlamaPriceEnricher,
  EnrichmentPipeline,
  EoaBasicsEnricher,
  ErcDetectorEnricher,
  ExplorerClient,
  ExplorerMetadataEnricher,
  RpcPool,
  resolveChains,
} from "@lighthouse/engine";

import { AddressBookStore } from "./data/address-book-store";
import { CacheStore } from "./data/cache-store";
import { WorkspaceIndexer } from "./domain/indexer";
import { registerAddressBookView } from "./ui/address-book";
import { registerCodeLens } from "./ui/codelens";
import { registerCommands } from "./ui/commands";
import { registerHover } from "./ui/hover";
import { InspectorController } from "./ui/inspector";
import { registerDiagnostics } from "./ui/diagnostics";

export async function activate(context: vscode.ExtensionContext) {
  const settings = getSettings();
  if (!settings.enabled) {
    return;
  }

  const cache = new CacheStore(context, settings.cache.ttlSeconds);
  await cache.init();

  const addressBook = new AddressBookStore(context);
  await addressBook.init();

  const rpcPool = new RpcPool(settings.rpc);
  const explorerApiKey = await context.secrets.get("lighthouse.explorerApiKey");
  const explorerClient = new ExplorerClient(explorerApiKey ?? undefined);
  const defillamaClient = new DefiLlamaClient();
  const pipeline = new EnrichmentPipeline([
    new EoaBasicsEnricher(),
    new ContractBasicsEnricher(),
    new ErcDetectorEnricher(),
    new ExplorerMetadataEnricher(explorerClient),
    new DefiLlamaPriceEnricher(defillamaClient),
  ]);
  const chains = resolveChains(settings.chains);
  const resolver = new AddressResolver({
    cache,
    rpcPool,
    pipeline,
    chains,
    scanMode: mapScanMode(settings.chains.mode),
  });
  const inspector = new InspectorController(context, { cache, resolver, addressBook });
  const indexer = new WorkspaceIndexer(addressBook);

  registerCommands(context, {
    cache,
    addressBook,
    indexer,
    inspector,
    explorerClient,
    secrets: context.secrets,
  });
  registerHover(context, { cache, resolver });
  registerCodeLens(context, { cache });
  registerAddressBookView(context, addressBook);
  registerDiagnostics(context);

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

function mapScanMode(mode: "workspaceLimited" | "userAll" | "singleChain") {
  switch (mode) {
    case "userAll":
      return "userChains";
    case "singleChain":
      return "singleChain";
    default:
      return "workspaceChains";
  }
}

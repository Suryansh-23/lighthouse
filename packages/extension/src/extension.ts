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
import { DocumentResolver } from "./domain/document-resolver";
import { registerAddressBookView } from "./ui/address-book";
import { registerCodeLens } from "./ui/codelens";
import { registerCommands } from "./ui/commands";
import { registerHover } from "./ui/hover";
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
  const explorerClient = new ExplorerClient(await loadExplorerApiKeys(context.secrets, settings));
  const defillamaClient = new DefiLlamaClient();
  const pipeline = new EnrichmentPipeline([
    new EoaBasicsEnricher(),
    new ContractBasicsEnricher(),
    new ErcDetectorEnricher(),
  ]);
  const backgroundPipeline = new EnrichmentPipeline([
    new ExplorerMetadataEnricher(explorerClient),
    new DefiLlamaPriceEnricher(defillamaClient),
  ]);
  const chains = resolveChains(settings.chains);
  const resolver = new AddressResolver({
    cache,
    rpcPool,
    pipeline,
    backgroundPipeline,
    chains,
    scanMode: mapScanMode(settings.chains.mode),
  });
  const indexer = new WorkspaceIndexer(addressBook);
  const documentResolver = new DocumentResolver(
    cache,
    resolver,
    settings.net.maxConcurrentRequests,
  );

  registerCommands(context, {
    cache,
    addressBook,
    indexer,
    explorerClient,
    secrets: context.secrets,
    resolver,
  });
  registerHover(context, { cache, resolver, addressBook });
  registerCodeLens(context, { cache, addressBook });
  registerAddressBookView(context, addressBook, cache, resolver);
  registerDiagnostics(context);

  if (!settings.security.respectWorkspaceTrust || vscode.workspace.isTrusted) {
    void indexer.scanWorkspace();
  }

  for (const doc of vscode.workspace.textDocuments) {
    documentResolver.scheduleDocument(doc);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      void indexer.scanDocument(doc);
      documentResolver.scheduleDocument(doc);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void indexer.scanDocument(doc);
      documentResolver.scheduleDocument(doc);
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

async function loadExplorerApiKeys(
  secrets: vscode.SecretStorage,
  settings: ReturnType<typeof getSettings>,
) {
  const kinds = ["routescan", "etherscan", "blockscout"] as const;
  const entries = await Promise.all(
    kinds.map(async (kind) => {
      const configValue = settings.explorer.apiKeys[kind];
      const key = configValue || (await secrets.get(`lighthouse.explorerApiKey.${kind}`));
      return [kind, key ?? undefined] as const;
    }),
  );

  return Object.fromEntries(entries) as Partial<Record<(typeof kinds)[number], string>>;
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

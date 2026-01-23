import * as vscode from "vscode";

import type { Address, OccurrenceRef } from "@lighthouse/shared";

import { extractAddressOccurrences } from "../core/extract";
import { getSettings } from "../core/settings";
import type { AddressBookStore } from "../data/address-book-store";

export class WorkspaceIndexer {
  constructor(private readonly addressBook: AddressBookStore) {}

  async scanWorkspace(): Promise<void> {
    const settings = getSettings();
    if (!settings.enabled) {
      return;
    }

    if (settings.security.respectWorkspaceTrust && !vscode.workspace.isTrusted) {
      return;
    }

    const include = buildIncludeGlob(settings.detection.fileGlobs);
    if (!include) {
      return;
    }

    const exclude = "**/{node_modules,dist,out,coverage,.git}/**";
    const uris = await vscode.workspace.findFiles(include, exclude);
    for (const uri of uris) {
      await this.scanUri(uri);
    }
  }

  async scanDocument(doc: vscode.TextDocument): Promise<void> {
    const settings = getSettings();
    if (!shouldScanDocument(doc)) {
      return;
    }

    if (settings.security.respectWorkspaceTrust && !vscode.workspace.isTrusted) {
      return;
    }

    const occurrences = extractAddressOccurrences(doc);
    const byAddress = new Map<Address, OccurrenceRef[]>();
    const uri = doc.uri.toString();

    for (const occurrence of occurrences) {
      const list = byAddress.get(occurrence.address) ?? [];
      list.push({
        uri,
        range: {
          start: {
            line: occurrence.range.start.line,
            char: occurrence.range.start.character,
          },
          end: {
            line: occurrence.range.end.line,
            char: occurrence.range.end.character,
          },
        },
      });
      byAddress.set(occurrence.address, list);
    }

    await this.addressBook.updateOccurrences(uri, byAddress);
  }

  private async scanUri(uri: vscode.Uri): Promise<void> {
    const stats = await vscode.workspace.fs.stat(uri);
    const maxFileSize = getMaxFileSize();
    if (stats.size > maxFileSize) {
      return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    await this.scanDocument(doc);
  }
}

function buildIncludeGlob(globs: string[]): string | undefined {
  if (!globs || globs.length === 0) {
    return undefined;
  }
  if (globs.length === 1) {
    return globs[0];
  }
  return `{${globs.join(",")}}`;
}

function shouldScanDocument(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === "file";
}

function getMaxFileSize(): number {
  const config = vscode.workspace.getConfiguration("files");
  const maxMb = config.get("maxMemoryForLargeFilesMB", 4096);
  return maxMb * 1024 * 1024;
}

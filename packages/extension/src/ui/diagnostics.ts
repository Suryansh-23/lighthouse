import * as vscode from "vscode";

import { extractAddressMatches } from "../core/extract";
import { getSettings } from "../core/settings";

const INVALID_ADDRESS_CODE = "lighthouse.addressInvalid";
const CHECKSUM_ADDRESS_CODE = "lighthouse.addressChecksum";
const checksumFixes = new Map<string, string>();

export function registerDiagnostics(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection("lighthouse");
  context.subscriptions.push(collection);

  const update = (doc: vscode.TextDocument) => {
    const settings = getSettings();
    if (!settings.enabled) {
      return;
    }
    if (settings.security.respectWorkspaceTrust && !vscode.workspace.isTrusted) {
      return;
    }
    if (doc.uri.scheme !== "file") {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    clearDocumentFixes(doc);
    for (const match of extractAddressMatches(doc)) {
      if (!match.normalized) {
        const diagnostic = new vscode.Diagnostic(
          match.range,
          "Invalid EVM address format.",
          vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.code = INVALID_ADDRESS_CODE;
        diagnostics.push(diagnostic);
        continue;
      }

      if (match.raw !== match.normalized) {
        const diagnostic = new vscode.Diagnostic(
          match.range,
          "Address is not checksummed.",
          vscode.DiagnosticSeverity.Information,
        );
        diagnostic.code = CHECKSUM_ADDRESS_CODE;
        const key = buildKey(doc.uri, match.range);
        checksumFixes.set(key, match.normalized);
        diagnostics.push(diagnostic);
      }
    }

    collection.set(doc.uri, diagnostics);
  };

  const schedule = createDebouncedUpdater(update);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => update(doc)),
    vscode.workspace.onDidChangeTextDocument(event => schedule(event.document)),
    vscode.workspace.onDidSaveTextDocument(doc => update(doc)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      collection.delete(doc.uri);
      clearDocumentFixes(doc);
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      new AddressCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );

  for (const doc of vscode.workspace.textDocuments) {
    update(doc);
  }
}

class AddressCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.code !== CHECKSUM_ADDRESS_CODE) {
        continue;
      }

      const normalized = checksumFixes.get(buildKey(document.uri, diagnostic.range));
      if (!normalized) {
        continue;
      }

      const action = new vscode.CodeAction(
        "Normalize to checksum",
        vscode.CodeActionKind.QuickFix,
      );
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, diagnostic.range, normalized);
      action.diagnostics = [diagnostic];
      actions.push(action);
    }

    return actions;
  }
}

function buildKey(uri: vscode.Uri, range: vscode.Range): string {
  return `${uri.toString()}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function clearDocumentFixes(doc: vscode.TextDocument) {
  const prefix = `${doc.uri.toString()}:`;
  for (const key of Array.from(checksumFixes.keys())) {
    if (key.startsWith(prefix)) {
      checksumFixes.delete(key);
    }
  }
}

function createDebouncedUpdater(update: (doc: vscode.TextDocument) => void) {
  const timers = new Map<string, NodeJS.Timeout>();
  return (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const handle = setTimeout(() => {
      timers.delete(key);
      update(doc);
    }, 250);
    timers.set(key, handle);
  };
}

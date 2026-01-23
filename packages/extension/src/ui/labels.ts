import * as vscode from "vscode";

import type { AddressBookStore } from "../data/address-book-store";

import { extractAddressOccurrences } from "../core/extract";

export function registerPinnedLabelDecorations(
  context: vscode.ExtensionContext,
  addressBook: AddressBookStore,
) {
  const decoration = vscode.window.createTextEditorDecorationType({
    before: {
      color: new vscode.ThemeColor("descriptionForeground"),
      fontStyle: "italic",
      margin: "0 12px 0 -16px",
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });

  const apply = (editor: vscode.TextEditor) => {
    const occurrences = extractAddressOccurrences(editor.document);
    const decorations: vscode.DecorationOptions[] = [];
    for (const occurrence of occurrences) {
      const entry = addressBook.getPinnedEntry(occurrence.address);
      if (!entry?.label) {
        continue;
      }
      const label = entry.label.length > 16 ? `${entry.label.slice(0, 16)}…` : entry.label;
      decorations.push({
        range: occurrence.range,
        renderOptions: {
          before: {
            contentText: label,
          },
        },
      });
    }

    editor.setDecorations(decoration, decorations);
  };

  const refreshAll = () => {
    for (const editor of vscode.window.visibleTextEditors) {
      apply(editor);
    }
  };

  context.subscriptions.push(decoration);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        apply(editor);
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.visibleTextEditors.find(
        item => item.document.uri.toString() === event.document.uri.toString(),
      );
      if (editor) {
        apply(editor);
      }
    }),
  );

  addressBook.onDidChange(() => refreshAll());
  refreshAll();
}

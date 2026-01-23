import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const inspectAddress = vscode.commands.registerCommand(
    "lighthouse.inspectAddress",
    async () => {
      void vscode.window.showInformationMessage(
        "Lighthouse: Inspect Address is not implemented yet.",
      );
    },
  );

  context.subscriptions.push(inspectAddress);
}

export function deactivate() {}

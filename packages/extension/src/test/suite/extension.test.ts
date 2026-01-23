import * as assert from "assert";

import * as vscode from "vscode";

suite("Extension activation", () => {
  test("registers inspect command", async () => {
    const extension = vscode.extensions.getExtension("lighthouse.lighthouse-extension");
    if (extension) {
      await extension.activate();
    }
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("lighthouse.inspectAddress"));
    assert.ok(commands.includes("lighthouse.openExplorer"));
    assert.ok(commands.includes("lighthouse.copyAddress"));
    assert.ok(commands.includes("lighthouse.addToAddressBook"));
    assert.ok(commands.includes("lighthouse.removeFromAddressBook"));
    assert.ok(commands.includes("lighthouse.reindexWorkspace"));
    assert.ok(commands.includes("lighthouse.revealOccurrences"));
    assert.ok(commands.includes("lighthouse.clearCache"));
    assert.ok(commands.includes("lighthouse.setExplorerApiKey"));
  });
});

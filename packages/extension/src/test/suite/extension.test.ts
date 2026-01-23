import * as assert from "assert";

import * as vscode from "vscode";

suite("Extension activation", () => {
  test("registers inspect command", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("lighthouse.inspectAddress"));
    assert.ok(commands.includes("lighthouse.openExplorer"));
    assert.ok(commands.includes("lighthouse.copyAddress"));
    assert.ok(commands.includes("lighthouse.addToAddressBook"));
  });
});

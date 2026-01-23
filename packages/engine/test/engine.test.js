const assert = require("assert");

const engine = require("../dist/index.js");

function testExtractAddresses() {
  const text = "0x0000000000000000000000000000000000000000 and 0x0000000000000000000000000000000000000000";
  const addresses = engine.extractAddressesFromText(text);
  assert.strictEqual(addresses.length, 1);
  assert.strictEqual(addresses[0], "0x0000000000000000000000000000000000000000");
}

function testResolveChains() {
  const chains = engine.resolveChains({
    mode: "workspaceLimited",
    workspaceAllowlist: [1],
    userChains: [],
  });
  assert.ok(chains.length > 0);
  assert.strictEqual(chains[0].chainId, 1);
}

function testExplorerUrl() {
  const url = engine.buildExplorerUrl("0x0000000000000000000000000000000000000000", undefined, "routescan");
  assert.ok(url.includes("routescan"));
  assert.ok(url.includes("address"));
}

try {
  testExtractAddresses();
  testResolveChains();
  testExplorerUrl();
  process.stdout.write("engine tests: ok\n");
} catch (error) {
  console.error("engine tests: failed", error);
  process.exit(1);
}

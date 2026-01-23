import * as assert from "assert";

import { buildExplorerUrl, extractAddressesFromText } from "@lighthouse/engine";

suite("Core utilities", () => {
  test("extracts unique addresses from text", () => {
    const text = "0x0000000000000000000000000000000000000000 and 0x0000000000000000000000000000000000000000";
    const addresses = extractAddressesFromText(text);
    assert.strictEqual(addresses.length, 1);
    assert.strictEqual(addresses[0], "0x0000000000000000000000000000000000000000");
  });

  test("builds explorer url", () => {
    const url = buildExplorerUrl("0x0000000000000000000000000000000000000000", undefined, "routescan");
    assert.ok(url.includes("routescan"));
    assert.ok(url.includes("address"));
  });
});

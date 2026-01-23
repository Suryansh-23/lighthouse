# Lighthouse Local Validation Plan

Use this plan to validate Lighthouse end to end in a local VS Code setup.
Leave notes and logs in the provided sections so we can iterate quickly.

## 1) Setup
1. Install dependencies
   - `pnpm install`
2. Build and test
   - `pnpm build`
   - `pnpm test`
3. Launch the extension host
   - VS Code -> Run and Debug -> "Run Lighthouse Extension"
   - Or run `pnpm extension:dev`

### Collecting debug info
- Output panel: View -> Output -> select "Log (Extension Host)"
- Developer Tools: Help -> Toggle Developer Tools -> Console
- If the extension fails to activate, run "Developer: Reload Window" in the
  extension host and re-open the output logs.

Notes/Logs:


## 2) Feature validation

### 2.1 Hover card
Steps:
1. Open a file that contains an EVM address (example: `0x0000000000000000000000000000000000000000`).
2. Hover the address.
3. Confirm the hover shows the checksummed address and actions.
4. Hover again after a few seconds and confirm resolved data appears.

Expected:
- Immediate hover with cached/placeholder data
- Later hover includes chain name, kind, and token or proxy info if available

Feedback/Logs:


### 2.2 CodeLens
Steps:
1. Open a file with multiple addresses.
2. Confirm CodeLens summaries appear above each address.
3. Use the CodeLens actions (Open, Copy, Inspect, Add).

Expected:
- CodeLens never blocks the editor
- Summary includes chain/kind/token when cached

Feedback/Logs:


### 2.3 Address book
Steps:
1. Open the "Lighthouse Address Book" view in the Explorer pane.
2. Pin an address from hover/CodeLens or the command palette.
3. Reindex the workspace from the view title or command.
4. Use context menu actions for open/copy/inspect/reveal.

Expected:
- Pinned and indexed sections are populated
- Reveal jumps to the correct file and range

Feedback/Logs:


### 2.4 Inspector webview
Steps:
1. Run "Lighthouse: Inspect Address..." and enter a valid address.
2. Switch through tabs (Overview, Chains, Contract, Token, Occurrences, Notes).
3. Click Copy, Explorer, Pin/Unpin.

Expected:
- Inspector renders quickly and updates after resolve
- Tabs show correct chain/contract/token info

Feedback/Logs:


### 2.5 Diagnostics and quick fixes
Steps:
1. Add a malformed address or a lowercase address in a file.
2. Confirm diagnostics appear.
3. Apply the "Normalize to checksum" quick fix.

Expected:
- Invalid address warnings show
- Quick fix replaces with checksummed address

Feedback/Logs:


### 2.6 Explorer metadata + DefiLlama pricing
Steps:
1. Run "Lighthouse: Set Explorer API Key" with a valid key.
2. Inspect a verified contract address.
3. Inspect an ERC20 token with a DefiLlama price.

Expected:
- Contract name/verification appears when API key is set
- Token price shows for supported chains

Feedback/Logs:


### 2.7 Cache and indexing behavior
Steps:
1. Clear cache via "Lighthouse: Clear Cache".
2. Hover an address to populate cache.
3. Re-open the file and confirm hover is immediate.
4. Reindex the workspace and verify address book updates.

Expected:
- Cache resets correctly
- Indexed occurrences are updated

Feedback/Logs:


## 3) Summary
Overall status:
- [ ] Pass
- [ ] Needs fixes

Key issues:


Next steps:

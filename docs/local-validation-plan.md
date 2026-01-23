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
3. Confirm the hover shows the checksummed address, chain summary, and actions.
4. Hover again after a few seconds and confirm resolved data appears.

Expected:
- Immediate hover with cached/placeholder data
- Chain summary includes kind, ERC type, and token symbol if available
- Deployment info shows block/creator/tx hash when available
- Notes appear if saved for that address

Feedback/Logs:


### 2.2 CodeLens + pinned labels
Steps:
1. Open a file with multiple addresses.
2. Confirm CodeLens summaries appear above each address.
3. Add a pinned label for one address and ensure it appears in CodeLens.

Expected:
- CodeLens never blocks the editor
- Summary includes chain/kind/token when cached
- Pinned label appears (prefix) when present

Feedback/Logs:


### 2.3 Address book
Steps:
1. Open the "Address Book" view in the Explorer pane.
2. Pin an address from hover/CodeLens or the command palette.
3. Expand a pinned or indexed address to load details.
4. Use context menu actions for open/copy/inspect/reveal.
5. Use inline pin buttons for indexed addresses.

Expected:
- Pinned and indexed sections are populated with icons
- Expanding an entry resolves and displays cached details
- Context menu actions work

Feedback/Logs:


### 2.4 Explorer panel + notes
Steps:
1. Run "Inspect Address..." and enter a valid address.
2. If prompted, select a chain.
3. Verify the explorer loads inside the panel.
4. Add notes in the notes editor and verify they persist.

Expected:
- Explorer opens to the selected chain
- Notes save and appear in hover cards

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
1. Run "Set Explorer API Key" and choose the explorer provider.
2. Inspect a verified contract address.
3. Inspect an ERC20 token with a DefiLlama price.

Expected:
- Contract name/verification appears when API key is set
- Token price shows for supported chains

Feedback/Logs:


### 2.7 Cache and indexing behavior
Steps:
1. Clear cache via "Clear Cache".
2. Hover an address to populate cache.
3. Re-open the file and confirm hover is immediate.
4. Reindex the workspace and verify address book updates.

Expected:
- Cache resets correctly
- Indexed occurrences are updated

Feedback/Logs:


### 2.8 Chain selection accuracy
Steps:
1. Inspect an address known to exist as a contract on multiple chains.
2. Ensure the chain selection dialog appears.
3. Open explorer for the selected chain and validate the address is correct.

Expected:
- Chain chooser appears when multiple chains resolve
- Selected chain opens the correct explorer

Feedback/Logs:


## 3) Summary
Overall status:
- [ ] Pass
- [ ] Needs fixes

Key issues:


Next steps:

import type * as vscode from "vscode";

import type { Address } from "@lighthouse/shared";

import { normalizeAddress } from "./addresses";

export const ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

export interface AddressHit {
  address: Address;
  range: vscode.Range;
}

export function extractAddressesFromText(text: string): Address[] {
  ADDRESS_REGEX.lastIndex = 0;
  const matches = text.matchAll(ADDRESS_REGEX);
  const addresses = new Set<Address>();

  for (const match of matches) {
    const normalized = normalizeAddress(match[0]);
    if (normalized) {
      addresses.add(normalized);
    }
  }

  return Array.from(addresses);
}

export function extractAddressAtPosition(
  doc: vscode.TextDocument,
  pos: vscode.Position,
): AddressHit | undefined {
  const range = doc.getWordRangeAtPosition(pos, /0x[a-fA-F0-9]{40}/);
  if (!range) {
    return undefined;
  }

  const raw = doc.getText(range);
  const normalized = normalizeAddress(raw);
  if (!normalized) {
    return undefined;
  }

  return { address: normalized, range };
}

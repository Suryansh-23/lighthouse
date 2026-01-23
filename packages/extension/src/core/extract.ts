import * as vscode from "vscode";

import type { Address } from "@lighthouse/shared";

import { normalizeAddress } from "./addresses";

export const ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

export interface AddressHit {
  address: Address;
  range: vscode.Range;
}

export interface AddressOccurrence {
  address: Address;
  range: vscode.Range;
}

export interface AddressMatch {
  raw: string;
  normalized?: Address;
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

export function extractAddressOccurrences(doc: vscode.TextDocument): AddressOccurrence[] {
  return extractAddressMatches(doc)
    .filter(match => match.normalized)
    .map(match => ({ address: match.normalized as Address, range: match.range }));
}

export function extractAddressMatches(doc: vscode.TextDocument): AddressMatch[] {
  const text = doc.getText();
  const matches: AddressMatch[] = [];

  ADDRESS_REGEX.lastIndex = 0;
  for (const match of text.matchAll(ADDRESS_REGEX)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const normalized = normalizeAddress(raw);
    const start = doc.positionAt(index);
    const end = doc.positionAt(index + raw.length);
    matches.push({ raw, normalized, range: new vscode.Range(start, end) });
  }

  return matches;
}

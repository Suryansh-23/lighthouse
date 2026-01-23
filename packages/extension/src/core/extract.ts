import * as vscode from "vscode";

import type { Address } from "@lighthouse/shared";
import type { AddressMatch as EngineAddressMatch } from "@lighthouse/engine";
import {
  extractAddressMatches as extractEngineMatches,
  extractAddressesFromText,
  normalizeAddress,
} from "@lighthouse/engine";

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

export { extractAddressesFromText };

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
  return extractEngineMatches(doc.getText()).map(match => toRangeMatch(doc, match));
}

function toRangeMatch(doc: vscode.TextDocument, match: EngineAddressMatch): AddressMatch {
  const start = doc.positionAt(match.index);
  const end = doc.positionAt(match.index + match.length);
  return {
    raw: match.raw,
    normalized: match.normalized,
    range: new vscode.Range(start, end),
  };
}

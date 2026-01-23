import type { Address } from "@lighthouse/shared";

import { normalizeAddress } from "./addresses";

export const ADDRESS_REGEX = /0x[a-fA-F0-9]{40}/g;

export interface AddressMatch {
  raw: string;
  normalized?: Address;
  index: number;
  length: number;
}

export function extractAddressesFromText(text: string): Address[] {
  const matches = extractAddressMatches(text);
  const addresses = new Set<Address>();
  for (const match of matches) {
    if (match.normalized) {
      addresses.add(match.normalized);
    }
  }
  return Array.from(addresses);
}

export function extractAddressMatches(text: string): AddressMatch[] {
  const matches: AddressMatch[] = [];
  ADDRESS_REGEX.lastIndex = 0;
  for (const match of text.matchAll(ADDRESS_REGEX)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const prev = index > 0 ? text[index - 1] : "";
    const next = text[index + raw.length] ?? "";
    if ((prev && isHexChar(prev)) || (next && isHexChar(next))) {
      continue;
    }
    const normalized = normalizeAddress(raw);
    matches.push({ raw, normalized, index, length: raw.length });
  }
  return matches;
}

function isHexChar(value: string): boolean {
  return /[a-fA-F0-9]/.test(value);
}

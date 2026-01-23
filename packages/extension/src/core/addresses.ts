import { getAddress } from "viem";

import type { Address } from "@lighthouse/shared";

export function normalizeAddress(value: string): Address | undefined {
  try {
    return getAddress(value) as Address;
  } catch {
    return undefined;
  }
}

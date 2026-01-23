import type { Address, AddressResolution } from "@lighthouse/shared";

export interface CacheStore {
  get(address: Address): AddressResolution | undefined;
  set(address: Address, value: AddressResolution): Promise<void>;
}

import * as SecureStore from "expo-secure-store"

import { secureSecrets, type SecureKV, type Secrets } from "./secrets"

const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }

const thisDeviceOnly: SecureKV = {
  getItemAsync: (key) => SecureStore.getItemAsync(key, options),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key, options),
}

export const secrets: Secrets = secureSecrets(thisDeviceOnly)

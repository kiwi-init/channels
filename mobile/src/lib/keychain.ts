import * as SecureStore from "expo-secure-store"

import { secureSecrets, type Secrets } from "./secrets"

export const secrets: Secrets = secureSecrets(SecureStore)

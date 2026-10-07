// Re-export types
export type {
  BotWithAccount,
  IntegrationAccountWithBot,
  UserProfile,
} from "./types";

// Re-export helpers
export {
  addIdIfNeeded,
  executeTransaction,
  caseInsensitiveSearch,
  isValidUuid,
  hashPasswordResetToken,
  getDbInstance,
  db,
} from "./helpers";

// Re-export isTauriMode from constants
export { isTauriMode } from "@/lib/env/constants";

// Re-export serialization functions needed across domain files
export {
  serializeJson,
  deserializeJson,
  normalizeContactMeta,
  normalizeContactMetaList,
  normalizeInsight,
  normalizeInsightList,
  encryptPayload,
  decryptPayload,
} from "../serialization";

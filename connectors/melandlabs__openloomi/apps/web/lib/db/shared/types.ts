import type { Bot, IntegrationAccount } from "../schema";

export type BotWithAccount = Bot & {
  platformAccount: IntegrationAccount | null;
};

export type IntegrationAccountWithBot = IntegrationAccount & {
  bot: Bot | null;
};

export type UserProfile = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  hasPassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  // User-level IANA timezone preference; null = follow browser-detected timezone.
  timezone: string | null;
  // Preferred hour cycle for time display ("h12" | "h23"); null = locale default.
  hourCycle: string | null;
};

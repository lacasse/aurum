import { firstAdmin, getSavedApiKeys } from "./repo";
import { keysFor, statesFor, type ApiKeys, type KeyStates } from "@/lib/api-keys";

/**
 * Which market-data keys a user fetches with.
 *
 * Their own, as saved on the settings page. The deployment's environment is
 * consulted only for its owner — the first account — so an installation that
 * has always carried its keys in `.env` upgrades with nothing to do, and the
 * people it invites do not spend its owner's allowance. The rule itself is
 * `keysFor` in lib/api-keys, where it is tested.
 *
 * Read per request, so a key saved in settings is in use at the next refresh.
 */
const fromEnvironment = (): Partial<ApiKeys> => ({
  twelvedata: process.env.TWELVEDATA_API_KEY ?? "",
  eodhd: process.env.EODHD_API_KEY ?? "",
});

async function isOwner(userId: string): Promise<boolean> {
  return (await firstAdmin())?.id === userId;
}

export async function apiKeys(userId: string): Promise<ApiKeys> {
  return keysFor(await getSavedApiKeys(userId), fromEnvironment(), await isOwner(userId));
}

/** What the settings page is told: set or not, from where, and the last four. */
export async function apiKeyStates(userId: string): Promise<KeyStates> {
  return statesFor(await getSavedApiKeys(userId), fromEnvironment(), await isOwner(userId));
}

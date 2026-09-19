import { getSavedApiKeys } from "./repo";
import { effectiveKey, PROVIDERS, stateOf, type ApiKeys, type KeyStates } from "@/lib/api-keys";

/**
 * Which market-data keys this installation actually uses.
 *
 * Read per request rather than at import, which is the point of moving them
 * out of the environment: a key saved in settings takes effect on the next
 * refresh, not on the next deployment.
 *
 * The environment is still consulted, and still wins where nothing has been
 * saved, so a stack that has always carried its keys in `.env` keeps working
 * after this upgrade with nothing to do.
 */
const fromEnvironment = (): Partial<ApiKeys> => ({
  twelvedata: process.env.TWELVEDATA_API_KEY ?? "",
  eodhd: process.env.EODHD_API_KEY ?? "",
});

export async function apiKeys(): Promise<ApiKeys> {
  const saved = await getSavedApiKeys();
  const env = fromEnvironment();
  return {
    twelvedata: effectiveKey(saved.twelvedata, env.twelvedata),
    eodhd: effectiveKey(saved.eodhd, env.eodhd),
  };
}

/** What the settings page is told: set or not, from where, and the last four. */
export async function apiKeyStates(): Promise<KeyStates> {
  const saved = await getSavedApiKeys();
  const env = fromEnvironment();
  return Object.fromEntries(
    PROVIDERS.map((p) => [p, stateOf(saved[p], env[p])]),
  ) as KeyStates;
}

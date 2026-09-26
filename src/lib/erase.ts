/** What has to be typed, exactly, to start a record over. Shown on the page. */
export const ERASE_PHRASE = "delete all my data";

/** Whether what was typed is the phrase: case and surrounding space forgiven. */
export function isErasePhrase(typed: unknown): boolean {
  return typeof typed === "string" && typed.trim().toLowerCase() === ERASE_PHRASE;
}

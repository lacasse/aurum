/**
 * Identifiers for rows the server creates.
 *
 * The store has its own `uid` for rows the browser invents, and it stays
 * there: this is imported by server code, and the store is a client module.
 * Both produce the same shape of value, and neither is a sequence — an id that
 * counts tells anyone who sees one how many there are.
 */
export function uid(): string {
  return crypto.randomUUID();
}

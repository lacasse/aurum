/**
 * Whether pages still being worked on are listed.
 *
 * `unreleased: true` on a nav entry keeps a page out of the sidebar of a built app
 * while leaving it exactly where it was in development, so work carries on
 * without a branch to maintain or a revert to re-apply. Promoting a page is
 * deleting one word.
 *
 * This hides rather than disables: the route is still built and still answers
 * to its URL. That is deliberate — it is how a page is checked in the real app
 * before it is promoted — so it is not a way to keep anything secret, only a
 * way to keep an unfinished page from being offered as though it were done.
 *
 * Also gates what an unreleased page brings with it elsewhere — a checklist
 * step, a celebration — so none of it reaches a built app before the page does.
 *
 * Read at module scope because Next replaces `process.env.NEXT_PUBLIC_*` at
 * build time; there is nothing to re-evaluate per render.
 */
export const SHOW_UNRELEASED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_SHOW_UNRELEASED === "1";


import { redirect } from "next/navigation";

/**
 * Budgets are part of the expenses page now.
 *
 * The two were one subject read twice: this page listed every category with
 * what it cost this month, and so did that one — the only difference being
 * that a budget is the figure you *meant* to spend and the expenses page shows
 * the figure you did. A limit is an attribute of a category, so it is set
 * where a category is defined and shown beside what the category actually
 * cost.
 *
 * Kept as a redirect rather than deleted: the route was in the sidebar for
 * months and is in browser histories and bookmarks.
 */
export default function BudgetsPage() {
  redirect("/expenses");
}

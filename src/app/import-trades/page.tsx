import { redirect } from "next/navigation";

/**
 * The trade importer moved into the one import flow, which reads whatever it
 * is given — and that flow is now a dialog on the Transactions page. The route
 * stays as a redirect: it is the kind of thing that ends up bookmarked.
 */
export default function ImportTradesPage() {
  redirect("/transactions");
}

import { redirect } from "next/navigation";

/**
 * The trade importer moved into the one import page, which reads whatever it
 * is given. The route stays as a redirect: it is the kind of thing that ends
 * up bookmarked.
 */
export default function ImportTradesPage() {
  redirect("/import");
}

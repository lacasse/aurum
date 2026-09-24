import { handle } from "@/db/http";

export const dynamic = "force-dynamic";

/** Who is signed in: enough for the page to know which controls to show. */
export async function GET() {
  return handle(async (user) => ({ username: user.username, role: user.role }));
}

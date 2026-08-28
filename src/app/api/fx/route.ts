import { handle } from "@/db/http";
import { usdCadRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => usdCadRate());
}

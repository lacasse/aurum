import { cookies } from "next/headers";
import { handle, readJson } from "@/db/http";
import { confirmPassword } from "@/db/confirm-password";
import { BadRequestError, findUser, setUserPassword } from "@/db/repo";
import { createSession, hashPassword } from "@/lib/auth";
import { passwordProblem } from "@/lib/invites";

export const dynamic = "force-dynamic";

/**
 * A new password. Changing it ends every session the account holds — that is
 * the point of changing one after a device is lost — and this browser is given
 * a fresh session straight away so the person making the change stays in.
 */
export async function PUT(req: Request) {
  return handle(async (user) => {
    const body = (await readJson(req)) as { password?: unknown; newPassword?: unknown };
    const next = typeof body.newPassword === "string" ? body.newPassword : "";
    const problem = passwordProblem(next);
    if (problem) throw new BadRequestError(problem);
    await confirmPassword(req, user, body.password);
    await setUserPassword(user.id, hashPassword(next));
    const fresh = await findUser(user.id);
    const session = createSession(user.id, fresh?.sessionEpoch ?? 0);
    (await cookies()).set(session.name, session.value, {
      httpOnly: session.httpOnly,
      secure: session.secure,
      sameSite: session.sameSite,
      path: session.path,
      maxAge: session.maxAge,
    });
    return { ok: true };
  });
}

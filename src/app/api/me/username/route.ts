import { handle, readJson } from "@/db/http";
import { confirmPassword } from "@/db/confirm-password";
import { BadRequestError, UsernameTakenError, renameUser } from "@/db/repo";
import { normaliseUsername, usernameProblem } from "@/lib/usernames";

export const dynamic = "force-dynamic";

/** A new username. Sessions carry the account's id, so nobody is signed out. */
export async function PUT(req: Request) {
  return handle(async (user) => {
    const body = (await readJson(req)) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? normaliseUsername(body.username) : "";
    const problem = usernameProblem(username);
    if (problem) throw new BadRequestError(problem);
    await confirmPassword(req, user, body.password);
    try {
      await renameUser(user.id, username);
    } catch (err) {
      if (err instanceof UsernameTakenError) throw new BadRequestError("That username is taken.");
      throw err;
    }
    return { username };
  });
}

import { hashPassword } from "../src/lib/auth";

const arg = process.argv[2]?.trim();
if (!arg) {
  console.error(
    "Usage: npm run hash-password -- <password>\n" +
      "Outputs a scrypt 'salt:hash' value to put in AUTH_PASSWORD_HASH in .env",
  );
  process.exit(1);
}

console.log(hashPassword(arg));

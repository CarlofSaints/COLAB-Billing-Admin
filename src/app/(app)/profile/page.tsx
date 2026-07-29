import { redirect } from "next/navigation";

/**
 * The profile now lives on /account, alongside sign-in details and password —
 * one page for "everything about me", reached from the avatar in the corner.
 *
 * This redirect stays because welcome and invite emails already sent point
 * here, and those links have to keep working.
 */
export default function ProfileRedirect() {
  redirect("/account");
}

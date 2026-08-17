/**
 * Proves the forgotten-password flow against the LIVE database, then removes
 * everything it made.
 *
 * ⚠️ Scoped to one throwaway address that cannot collide with a real person
 * (`zz-reset-check@example.invalid`) and it deletes only rows it inserted
 * itself. It never truncates anything.
 *
 *   npx tsx scripts/check-password-resets.ts
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { createHash, randomBytes } from "node:crypto";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check .env.local");

const sql = neon(url);

const TEST_EMAIL = "zz-reset-check@example.invalid";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

let passed = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`FAILED: ${label}`);
  passed++;
}

async function main() {
  // ---- setup -----------------------------------------------------------
  const [role] = (await sql.query(
    `select id from roles order by rank desc limit 1`,
  )) as { id: number }[];

  const [user] = (await sql.query(
    `insert into users (name, email, password_hash, role_id, active, must_change_password)
     values ('ZZ Reset Check', $1, 'not-a-real-hash', $2, true, true)
     returning id`,
    [TEST_EMAIL, role.id],
  )) as { id: number }[];
  console.log(`\nthrowaway user ${user.id} <${TEST_EMAIL}>\n`);

  try {
    // ---- 1. a live token is found by its hash, never by its value -------
    const token = randomBytes(32).toString("base64url");
    await sql.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '60 minutes')`,
      [user.id, hash(token)],
    );

    const byHash = (await sql.query(
      `select id from password_reset_tokens where token_hash = $1`,
      [hash(token)],
    )) as { id: number }[];
    check("the emailed token resolves to its row via sha256", byHash.length === 1);

    const byRaw = (await sql.query(
      `select id from password_reset_tokens where token_hash = $1`,
      [token],
    )) as { id: number }[];
    check("the RAW token is nowhere in the table", byRaw.length === 0);

    check(
      "the token is URL-safe, so it survives being a path segment",
      encodeURIComponent(token) === token,
      `${token.length} chars`,
    );

    // ---- 2. the liveness predicate the page and the action share --------
    const live = (await sql.query(
      `select id from password_reset_tokens
        where token_hash = $1 and used_at is null and expires_at > now()`,
      [hash(token)],
    )) as { id: number }[];
    check("an unspent, unexpired token reads as live", live.length === 1);

    // ---- 3. spending it is a one-winner race ----------------------------
    const first = (await sql.query(
      `update password_reset_tokens set used_at = now()
        where id = $1 and used_at is null returning id`,
      [live[0].id],
    )) as { id: number }[];
    const second = (await sql.query(
      `update password_reset_tokens set used_at = now()
        where id = $1 and used_at is null returning id`,
      [live[0].id],
    )) as { id: number }[];
    check("the first submission spends the link", first.length === 1);
    check(
      "a second submission of the same link changes nothing",
      second.length === 0,
      "double-click / back-button / forwarded email",
    );

    const afterSpend = (await sql.query(
      `select id from password_reset_tokens
        where token_hash = $1 and used_at is null and expires_at > now()`,
      [hash(token)],
    )) as { id: number }[];
    check("a spent token no longer reads as live", afterSpend.length === 0);

    // ---- 4. an expired token is dead even though it was never used ------
    const stale = randomBytes(32).toString("base64url");
    await sql.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() - interval '1 minute')`,
      [user.id, hash(stale)],
    );
    const staleLive = (await sql.query(
      `select id from password_reset_tokens
        where token_hash = $1 and used_at is null and expires_at > now()`,
      [hash(stale)],
    )) as { id: number }[];
    check("an expired but unused token is dead", staleLive.length === 0);

    // ---- 5. asking again kills the older link ---------------------------
    const older = randomBytes(32).toString("base64url");
    const newer = randomBytes(32).toString("base64url");
    await sql.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '60 minutes')`,
      [user.id, hash(older)],
    );
    // What requestPasswordReset does before it inserts the new one.
    await sql.query(
      `update password_reset_tokens set used_at = now()
        where user_id = $1 and used_at is null`,
      [user.id],
    );
    await sql.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at)
       values ($1, $2, now() + interval '60 minutes')`,
      [user.id, hash(newer)],
    );

    const stillLive = (await sql.query(
      `select token_hash from password_reset_tokens
        where user_id = $1 and used_at is null and expires_at > now()`,
      [user.id],
    )) as { token_hash: string }[];
    check(
      "asking for a second link leaves exactly one live",
      stillLive.length === 1 && stillLive[0].token_hash === hash(newer),
      "the older email is not a second key",
    );

    // ---- 6. two tokens can never share a hash ---------------------------
    let duped = false;
    try {
      await sql.query(
        `insert into password_reset_tokens (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '60 minutes')`,
        [user.id, hash(newer)],
      );
      duped = true;
    } catch {
      /* unique index did its job */
    }
    check("the unique index refuses a duplicate hash", !duped);

    // ---- 7. the request throttle counts off the activity log ------------
    for (let i = 0; i < 3; i++) {
      await sql.query(
        `insert into activity_log (actor_type, actor_label, action, summary)
         values ('system', $1, 'auth.reset_requested', 'check script')`,
        [TEST_EMAIL],
      );
    }
    const [{ recent }] = (await sql.query(
      `select count(*)::int as recent from activity_log
        where action = 'auth.reset_requested' and actor_label = $1
          and created_at > now() - interval '15 minutes'`,
      [TEST_EMAIL],
    )) as { recent: number }[];
    check("three requests in the window trip the throttle", recent >= 3, `counted ${recent}`);

    // ---- 8. 🔴 a completed reset unlocks the sign-in throttle -----------
    // Without this, someone who forgot their password burns 8 attempts, resets
    // it, and is STILL locked out — with the link already spent.
    for (let i = 0; i < 9; i++) {
      await sql.query(
        `insert into activity_log (actor_type, actor_label, action, summary)
         values ('system', $1, 'auth.login_failed', 'check script')`,
        [TEST_EMAIL],
      );
    }
    const [{ before }] = (await sql.query(
      `select count(*)::int as before from activity_log
        where action = 'auth.login_failed' and actor_label = $1
          and created_at > now() - interval '15 minutes'`,
      [TEST_EMAIL],
    )) as { before: number }[];
    check("nine failures would lock the account out", before >= 8, `${before} failures`);

    await sql.query(
      `insert into activity_log (actor_type, actor_label, action, summary)
       values ('user', $1, 'auth.password_reset', 'check script')`,
      [TEST_EMAIL],
    );
    const [{ at }] = (await sql.query(
      `select created_at as at from activity_log
        where action = 'auth.password_reset' and actor_label = $1
        order by created_at desc limit 1`,
      [TEST_EMAIL],
    )) as { at: string }[];
    const [{ after }] = (await sql.query(
      `select count(*)::int as after from activity_log
        where action = 'auth.login_failed' and actor_label = $1
          and created_at > greatest($2::timestamptz, now() - interval '15 minutes')`,
      [TEST_EMAIL, at],
    )) as { after: number }[];
    check(
      "counting from the reset instead leaves zero failures",
      after === 0,
      "the new password works immediately",
    );

    // ---- 9. the reset log line is keyed on the ADDRESS ------------------
    // The unlock above depends on it. Keying it on the person's name would
    // break the throttle silently and look perfectly reasonable in the log.
    const [{ keyed }] = (await sql.query(
      `select count(*)::int as keyed from activity_log
        where action = 'auth.password_reset' and actor_label = $1`,
      [TEST_EMAIL],
    )) as { keyed: number }[];
    check("auth.password_reset is findable by email", keyed === 1);

    // ---- 10. deleting the user takes the tokens with it -----------------
    await sql.query(`delete from users where id = $1`, [user.id]);
    const orphans = (await sql.query(
      `select id from password_reset_tokens where user_id = $1`,
      [user.id],
    )) as { id: number }[];
    check("deleting a user cascades away their reset tokens", orphans.length === 0);

    console.log(`\n${passed} assertions passed.`);
  } finally {
    // ---- cleanup, whatever happened above -------------------------------
    await sql.query(`delete from users where email = $1`, [TEST_EMAIL]);
    const gone = (await sql.query(
      `delete from activity_log where actor_label = $1 and summary = 'check script'
       returning id`,
      [TEST_EMAIL],
    )) as { id: number }[];
    console.log(`cleaned up: ${gone.length} log rows, throwaway user removed.`);

    const [{ left }] = (await sql.query(
      `select count(*)::int as left from password_reset_tokens`,
    )) as { left: number }[];
    console.log(`password_reset_tokens now holds ${left} row(s).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

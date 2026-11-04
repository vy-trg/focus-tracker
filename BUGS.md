# Bugs I hit and what I learned

## Database password committed to Git (30 Oct 2026)

**What happened:** I made a backup of `.env` called `.env.bak`. My `.gitignore` only ignored `.env` exactly, so the backup was committed with my Neon connection string. Deleting it in the next commit didn't help: it was still in the history, and the history became public when I made the repo public.

**Fix:**
- Rotated the Neon password the same day. On 3 Nov I verified the leaked one fails with `password authentication failed`.
- `.gitignore` now ignores `.env.*` except `.env.example`.
- Rewrote the history with `git filter-repo` to remove `.env.bak` from every commit, then force-pushed (suggested by Chris: nobody needs to know the database host or user name either).
- Added gitleaks as a pre-commit hook and in GitHub Actions.
- GitHub still keeps the old commits behind Pull Request #1 (`refs/pull/1/head`), which a force push can't overwrite. I asked GitHub Support to remove them on 3rd November. The password in them was already rotated, so this only hides the database host and user name.

**Lesson:** Once a secret is pushed, treat it as public. Revoke it first, then clean up. Deleting the file is not enough.

## My gitleaks hook passed a real-looking token (3 Nov 2026)

**What happened:** After installing the `gitleaks-system` pre-commit hook, I tested it with a fake GitHub token. The commit went through. Running `gitleaks` by hand found the token, so the scanner worked but the hook didn't.

**Cause:** pre-commit passes the staged file names as arguments. `gitleaks git` reads the last argument as the repo path, so it tried to open `leak-test.js` as a folder, scanned 0 bytes, and still exited with "no leaks found".

**Fix:** A local hook that calls `gitleaks git --pre-commit --staged --redact` with `pass_filenames: false`. Re-tested: the commit is now blocked.

**Lesson:** A security check that hasn't been tested to fail isn't a check. Test the bad case, not just the good one.

## `node --test` ran my database script as a test (4 Nov 2026)

**What happened:** With `"test": "node --test"`, the test run printed "Attempting to connect to PostgreSQL".

**Cause:** With no file list, `node --test` picks up any file named `test-*.js`, so it ran `scripts/test-db.js`, which connects to the real database.

**Fix:** `"test": "node --test test/*.test.js"`, so only files in `test/` run.

**Lesson:** Be explicit about what a tool runs. Unit tests should never touch a real database.
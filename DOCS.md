# WikINT CLI Documentation

All CLI commands are run through the Typer-based CLI at `api/app/cli.py`.

**Running commands** (inside the API Docker container):

```bash
docker compose exec api uv run python -m app.cli <command> [options]
```

---

## `seed`

Create or update a user and bootstrap the default directory structure.

```bash
docker compose exec api uv run python -m app.cli seed --email <EMAIL> [--role <ROLE>]
```

| Option    | Required | Default  | Description            |
| --------- | -------- | -------- | ---------------------- |
| `--email` | Yes      | —        | Email of the user      |
| `--role`  | No       | `bureau` | Role to assign         |

**Available roles:** `student`, `member`, `bureau`, `vieux`

Admin access is granted to `bureau` and `vieux` roles.

**Behavior:**

- If a user with that email already exists, their role is updated.
- If the user does not exist, a new account is created with the given role.
- Creates the default directory tree if it doesn't exist: `1A/(S1, S2)`, `2A/(S1, S2)`, `3A/(S1, S2)`.

**Examples:**

```bash
# Create/promote a user to bureau (admin)
docker compose exec api uv run python -m app.cli seed --email "admin@example.com"

# Create a regular student account
docker compose exec api uv run python -m app.cli seed --email "student@example.com" --role student
```

---

## `reindex`

Rebuild all Meilisearch indexes from the database.

```bash
docker compose exec api uv run python -m app.cli reindex
```

No options. Ensures Meilisearch indexes exist, then re-indexes all materials and directories from PostgreSQL.

**Use when:**

- Meilisearch data is out of sync with the database.
- After restoring a database backup.
- After manually modifying records.

---

## `gdpr-cleanup`

Purge soft-deleted users that are past the 30-day grace period.

```bash
docker compose exec api uv run python -m app.cli gdpr-cleanup
```

No options. Runs the same logic as the background worker (`app.workers.gdpr_cleanup`), but synchronously from the command line.

---

## `year-rollover`

Bump academic years for all users: 1A → 2A, 2A → 3A+, 3A+ stays.

```bash
docker compose exec api uv run python -m app.cli year-rollover
```

No options. Runs the same logic as the background worker (`app.workers.year_rollover`), but synchronously from the command line. Intended to be run once at the start of each academic year.

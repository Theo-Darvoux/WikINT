# CLI Reference

WikINT provides a Typer-based CLI for administrative tasks. All commands run inside the API container.

**Key file**: `api/app/cli.py`

---

## Running Commands

```bash
docker compose exec api uv run python -m app.cli <command> [options]
```

---

## Commands

### `seed`

Create or update a user and bootstrap the default directory structure.

```bash
docker compose exec api uv run python -m app.cli seed --email <EMAIL> [--role <ROLE>]
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--email` | Yes | -- | Email of the user |
| `--role` | No | `bureau` | Role to assign |

**Roles**: `student`, `member`, `bureau`, `vieux`

**Behavior**:
- If a user with that email exists, their role is updated
- If the user doesn't exist, a new account is created
- Creates the default directory tree if it doesn't exist: `1A/(S1, S2)`, `2A/(S1, S2)`, `3A/(S1, S2)`

**Examples**:

```bash
# Create an admin account
docker compose exec api uv run python -m app.cli seed --email "admin@example.com"

# Create a student account
docker compose exec api uv run python -m app.cli seed --email "student@example.com" --role student

# Promote an existing user to bureau
docker compose exec api uv run python -m app.cli seed --email "user@example.com" --role bureau
```

---

### `reindex`

Rebuild all Meilisearch indexes from the database.

```bash
docker compose exec api uv run python -m app.cli reindex
```

No options. This command:

1. Ensures Meilisearch indexes exist with correct settings (searchable attributes, typo tolerance)
2. Loads all materials with tags and authors from PostgreSQL
3. Builds search documents with ancestor paths, browse paths, and split identifiers
4. Upserts all documents to the `materials` index
5. Repeats for all directories in the `directories` index

**Use when**:
- Search results are out of sync with the database
- After restoring a database backup
- After manually modifying records in PostgreSQL
- After a Meilisearch data loss

---

### `gdpr-cleanup`

Purge soft-deleted users past the 30-day retention period.

```bash
docker compose exec api uv run python -m app.cli gdpr-cleanup
```

No options. Runs the same logic as the `gdpr_cleanup` background worker cron job (daily at 04:00 UTC), but synchronously from the command line.

Hard-deletes all users where `deleted_at` is set and older than 30 days. Cascading foreign keys remove related data (comments, annotations, etc.).

---

### `year-rollover`

Bump academic years for all active users.

```bash
docker compose exec api uv run python -m app.cli year-rollover
```

No options. Runs the same logic as the `year_rollover` background worker cron job (September 1st at 02:00 UTC).

| Current Year | New Year |
|-------------|----------|
| `1A` | `2A` |
| `2A` | `3A+` |
| `3A+` | `3A+` (unchanged) |

Only affects non-deleted users with a non-null `academic_year` field.

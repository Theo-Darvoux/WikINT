# Backup Service

## Purpose

Creates and restores point-in-time ZIP snapshots of the platform state. Intended for disaster recovery and data migration.

## Scope

### What is backed up

| Layer | Content |
|-------|---------|
| **Database** | `users`, `tags`, `directories`, `materials`, `pull_requests`, `material_versions`, `material_tags`, `directory_tags`, `pr_file_claims`, `pr_comments` |
| **S3** | `cas/`, `uploads/`, `thumbnails/` prefixes |

### What is excluded

- `quarantine/` prefix (transient unscanned files, always short-lived)
- Annotations, comments, flags, notifications, view history, download audit (operational telemetry — not part of core content state)
- Redis state (CAS ref-counts rebuild automatically over time; run a storage reconciliation after restore if needed)

## ZIP Format

```
backup_{YYYYMMDD}_{HHMMSS}.zip
├── manifest.json          # version, timestamp, table list, row counts, s3 object count
├── db/
│   ├── users.json
│   ├── tags.json
│   ├── directories.json
│   ├── materials.json
│   ├── pull_requests.json
│   ├── material_versions.json
│   ├── material_tags.json
│   ├── directory_tags.json
│   ├── pr_file_claims.json
│   └── pr_comments.json
└── s3/
    └── {key}              # full prefix preserved (e.g. s3/cas/abc123)
```

Manifest version: `1.0`. Restores from a different version are rejected.

## API Endpoints

All endpoints require `BUREAU` or `VIEUX` role.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/backup` | List server-local backups |
| `POST` | `/api/admin/backup/save` | Create backup and save on server (rotation: max 3) |
| `GET` | `/api/admin/backup/export` | Create backup and stream to client (no server copy) |
| `GET` | `/api/admin/backup/{id}/download` | Download a server-local backup |
| `DELETE` | `/api/admin/backup/{id}` | Delete a server-local backup |
| `POST` | `/api/admin/backup/{id}/restore` | Full-replacement restore from server-local backup |
| `POST` | `/api/admin/backup/restore/upload` | Full-replacement restore from uploaded ZIP |

## Restore Behaviour

Restore is a **full replacement**:

1. All rows in backed-up tables are deleted (reverse FK order).
2. Backup rows are inserted (FK-safe forward order).
3. All S3 objects under `cas/`, `uploads/`, `thumbnails/` are deleted then re-uploaded from the ZIP.

Self-referential FKs (`directories.parent_id`, `materials.parent_material_id`, `pr_comments.parent_id`) are handled via topological sort so parents are always inserted before children.

`pull_requests.reverts_pr_id` / `reverted_by_pr_id` are set to NULL during INSERT then updated in a second pass to avoid circular FK violations.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `BACKUP_DIR` | `/var/lib/wikint/backups` | Server-local backup storage path |

The directory is created automatically on startup.

## Local Backup Rotation

`POST /api/admin/backup/save` enforces a maximum of **3** server-local backups. When a new backup would exceed this limit, the oldest backup is deleted before saving the new one.

## Limitations

- Restore is synchronous and blocks the HTTP request. Large deployments (multi-GB) may hit proxy timeouts; running the process directly on the server is recommended for those cases.
- S3 objects are read one at a time during backup creation and restore. Memory usage is bounded to one file at a time.
- Redis CAS metadata (`upload:cas:*` keys) is not included. After restore, run storage reconciliation (`GET /api/admin/storage/reconcile`) to verify consistency.

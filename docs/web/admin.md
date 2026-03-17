# Admin Pages

The admin section provides moderation and management tools. Access is restricted to users with MEMBER, BUREAU, or VIEUX roles.

**Key files**: `web/src/app/admin/layout.tsx`, `web/src/app/admin/page.tsx`, `web/src/app/admin/users/page.tsx`, `web/src/app/admin/flags/page.tsx`, `web/src/app/admin/directories/page.tsx`, `web/src/app/admin/pull-requests/page.tsx`

---

## Admin Layout

`web/src/app/admin/layout.tsx` wraps all admin pages:
- **Access control**: Checks `user.role` is `member`, `bureau`, or `vieux`. Shows "Permission denied" for other roles.
- **Navigation tabs**: Dashboard, Users, Flags, Directories, Pull Requests (with icons from Lucide)
- Active tab detection via `usePathname()`

---

## Dashboard (`/admin`)

Displays 4 stat cards from `GET /api/admin/stats`:
- Total Users
- Total Materials
- Open Pull Requests
- Open Flags

---

## Users Management (`/admin/users`)

- **Search**: Text input with 300ms debounce, searches email and display name
- **Role filter**: Dropdown (all / student / member / bureau / vieux)
- **Table columns**: Email, Display Name, Role, Onboarded, Created At, Actions
- **Role editing**: Dropdown selector per user — only available to BUREAU/VIEUX. Users cannot edit their own role.
- **Delete**: Soft delete with confirmation dialog explaining the 30-day GDPR grace period
- **Pagination**: Previous/Next buttons

API: `GET /api/admin/users`, `PATCH /api/admin/users/{id}/role`, `DELETE /api/admin/users/{id}`

---

## Flags Review (`/admin/flags`)

- **Filters**: Status (all / open / reviewing / resolved / dismissed), Target Type (all / material / annotation / pull_request / comment / pr_comment)
- **Flag cards**: Target type badge, status badge (color-coded: yellow=open, blue=reviewing, green=resolved, gray=dismissed), reason badge, reporter info, description, timestamps
- **Actions**: Resolve or Dismiss buttons (visible for open/reviewing flags)
- **Pagination**: 20 items per page

API: `GET /api/flags`, `PATCH /api/flags/{id}`

---

## Directories (`/admin/directories`)

- Read-only recursive tree view
- Fetches all directories from `GET /api/admin/directories`
- Renders nested structure with indentation and connecting borders
- Type icons: FileBox for modules, Folder icon for folders
- "System" badge for system-created directories (e.g., attachment folders)

---

## PR Queue (`/admin/pull-requests`)

- Fetches open PRs from `GET /api/pull-requests?status=open&limit=50`
- Client-side search on title
- Table columns: Title, Type, Votes, Submitted, Action
- "Review" button links to `/pull-requests/{id}` detail page
- Type and date columns hidden on mobile


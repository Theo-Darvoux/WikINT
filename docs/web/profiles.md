# Profiles

User profiles display personal information, reputation, contribution history, and recently viewed materials. Users can edit their own profile, upload avatars, and manage account settings.

**Key files**: `web/src/app/profile/page.tsx`, `web/src/app/profile/[id]/page.tsx`, `web/src/app/settings/page.tsx`, `web/src/components/profile/profile-view.tsx`, `web/src/components/profile/contribution-list.tsx`, `web/src/components/profile/recently-viewed.tsx`, `web/src/components/profile/reputation-badge.tsx`

---

## Profile Pages

### Own Profile (`/profile`)
Protected by `AuthGuard`. Fetches from `GET /api/users/me`. Features:
- Avatar upload via presigned URL flow (request URL → PUT → complete → PATCH /users/me)
- Editable profile fields (display name, bio, academic year)
- "Recently Viewed" section
- Contribution tabs

### Public Profile (`/profile/[id]`)
Fetches from `GET /api/users/{id}`. Read-only view. Shows 404 message if user not found or deleted.

---

## ProfileView Component

`web/src/components/profile/profile-view.tsx` — the main profile display:

- **Banner**: Gradient header that varies by role. BUREAU/VIEUX roles get premium animations (floating particles, shimmer effects)
- **Avatar**: Large circular image, clickable for upload on own profile
- **Stat cards**: Animated counters for reputation, approved PRs, annotations, comments
- **Edit form**: Inline editing for display_name, bio, academic_year
- **Tabs**: Contributions (PRs / materials / annotations) and Recently Viewed

### ReputationBadge (`reputation-badge.tsx`)
Simple pill component showing a star icon and numeric score.

---

## ContributionList (`contribution-list.tsx`)

Paginated list component supporting three contribution types:

| Type | API | Row Content |
|------|-----|-------------|
| `prs` | `GET /users/{id}/contributions?type=prs` | PR title, status badge, vote score |
| `materials` | `GET /users/{id}/contributions?type=materials` | Material title with type icon/color |
| `annotations` | `GET /users/{id}/contributions?type=annotations` | Annotation body excerpt, material reference |

Includes 70+ file type/extension mappings for visual indicators (icons and colors per material type).

---

## RecentlyViewed (`recently-viewed.tsx`)

Fetches from `GET /api/users/me/recently-viewed`. Displays materials in the same row format as ContributionList with type indicators and timestamps. Empty state shows a clock icon.

---

## Settings Page (`/settings`)

`web/src/app/settings/page.tsx` provides three cards:

1. **Appearance**: Theme toggle (light/dark) via `useTheme()`
2. **Data Export**: Downloads full GDPR data export as JSON (`GET /api/users/me/data-export`)
3. **Delete Account**: Destructive action with confirmation dialog explaining the 30-day GDPR cleanup period. Calls `DELETE /api/users/me`, then `POST /auth/logout`, navigates to `/login`

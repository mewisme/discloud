# DisCloud Web Client Implementation Plan

> Standalone source-of-truth roadmap for the DisCloud web client.
>
> Current checkpoint: **2026-08-21**
>
> Repository: `mewisme/discloud` · branch `main`
>
> Current formal phase: **Phase 18 — Testing, performance & web release stabilization**
>
> Total: **19 phases, Phase 0 through Phase 18**.
>
> Current posture: **Phase 0–17 implementation is complete. Phase 18 is now the only remaining formal phase before Web V1 can be declared release-ready.**

## 1. Roadmap numbering

The formal web roadmap contains **19 phases**, numbered **0–18**. Historical labels such as `14A/14B` or `16A/16B` are implementation sub-batches inside their parent phase and do not change roadmap numbering.

The current source includes substantial UX/product evolution after the original Phase 16 admin milestone. Those changes are recorded inside the relevant phase/checkpoint sections rather than inventing new formal phases.

## 2. Milestones and current status

| Milestone | Phases | Status |
| --- | --- | --- |
| MVP usable | Phase 0 → 10 | ✅ DONE |
| Collaboration complete | Phase 11 → 15 | ✅ DONE |
| Self-host management complete | Phase 16 | ✅ DONE |
| UX/accessibility/resilience | Phase 17 | ✅ DONE |
| Web V1 release stabilization | Phase 18 | 🚧 CURRENT |

Current count:

- **Phase 0–17:** complete.
- **Phase 18:** current and final formal phase.
- **1 formal phase remains to close Web V1.**
- Current implementation is feature-complete enough for release certification, but the final test/performance/accessibility/build evidence is not yet recorded as complete.

---

# 3. Formal roadmap

## Phase 0 — Web architecture & conventions

**Status: ✅ DONE**

- [x] Stable `web/src/` structure.
- [x] Server Component vs Client Component conventions.
- [x] Public/auth/app route groups and error/loading/not-found boundaries.
- [x] Naming/import/component ownership rules.
- [x] Shared primitive reuse before custom components.
- [x] No unnecessary global state library.

## Phase 1 — Environment & API foundation

**Status: ✅ DONE**

- [x] Server/browser environment strategy.
- [x] Typed fetch layer with cookie auth.
- [x] Unified `APIError` from Problem Details.
- [x] Timeout/AbortController support.
- [x] JSON/query/download/binary helpers.
- [x] Backend secrets remain server-only.

## Phase 2 — API contracts & client models

**Status: ✅ DONE**

- [x] OpenAPI-backed TypeScript models.
- [x] Setup/auth/user/node/file/upload/share/collection/search/admin models.
- [x] Cursor and ACL models.
- [x] Problem/error mapping.
- [x] API type drift check workflow.
- [x] Client code does not invent backend response fields.

## Phase 3 — First-install setup

**Status: ✅ DONE**

- [x] Setup status and fresh-install redirect.
- [x] First-admin form.
- [x] Concurrent setup conflict handling.
- [x] Initialized deployments cannot rerun setup.
- [x] Setup now captures display name plus immutable username.

## Phase 4 — Authentication & session

**Status: ✅ DONE**

- [x] Login/logout.
- [x] Current user/session bootstrap.
- [x] Guest/auth route protection.
- [x] Disabled/expired session handling.
- [x] App-wide 401 behavior.
- [x] Cookie auth only; no browser-stored auth tokens.
- [x] Login remains username-based after display-name changes.

## Phase 5 — MFA

**Status: ✅ DONE**

- [x] TOTP/recovery-code login challenge.
- [x] Enrollment and QR/secret flow.
- [x] Verification/recovery-code UX.
- [x] Disable/regenerate flows.
- [x] Sensitive MFA data is not persisted in browser storage.

## Phase 6 — Application shell

**Status: ✅ DONE**

- [x] Main layout/sidebar/header/user menu.
- [x] System/light/dark theme.
- [x] Responsive/mobile navigation.
- [x] Workspace and Management sidebar groups.
- [x] Quota/storage indicator.
- [x] Global toast/dialog infrastructure.
- [x] Command palette.
- [x] Workspace switcher for admin access to other users' workspaces.

## Phase 7 — Folder navigation & file browser

**Status: ✅ DONE**

- [x] Root/nested folder browsing.
- [x] Breadcrumbs.
- [x] List/grid view.
- [x] Sorting and cursor/infinite loading.
- [x] File/folder icons, type/category and size/date formatting.
- [x] Deep-linkable folder routes.
- [x] Parent `..` navigation and compact breadcrumbs.
- [x] Folder size is displayed in list/grid using recursive backend subtree size.
- [x] Size sorting works for both files and folders.
- [x] Workspace root breadcrumb uses display name while URLs remain username-based.

## Phase 8 — Node operations

**Status: ✅ DONE**

- [x] Create folder, rename and move.
- [x] Multi-select and bulk actions.
- [x] Favorite/unfavorite.
- [x] Permission-aware menus and context menus.
- [x] Conflict/cross-owner error handling.
- [x] Keyboard selection/actions and double-click navigation.

## Phase 9 — Upload system

**Status: ✅ DONE**

- [x] File picker and drag/drop.
- [x] Client chunking/SHA-256.
- [x] Upload-session creation and bounded part concurrency.
- [x] Retry/cancel/resume/finalize.
- [x] Quota/conflict handling.
- [x] Upload queue survives app navigation while `UploadProvider` remains mounted.
- [x] Multi-file upload.
- [x] Complete folder-tree upload with relative paths and merge semantics.
- [x] Folder-tree collision handling distinguishes existing files from structural conflicts.
- [x] React Dropzone paths beginning with benign `./` are accepted without weakening traversal protection.
- [x] Upload manager moved from Sheet overlay to a full page for better visibility.

## Phase 10 — File viewing & downloads

**Status: ✅ DONE**

- [x] File details/download.
- [x] Range-aware media delivery.
- [x] Image/video/audio/text/PDF preview behavior where supported.
- [x] Unsupported-file fallback.
- [x] Folder ZIP download.
- [x] Metadata pending/ready/failed states.
- [x] Preview carousel and previous/next navigation.
- [x] Bounded preview preloading and request dedupe.

## Phase 11 — Search

**Status: ✅ DONE**

- [x] URL-synced global search.
- [x] Type/category/folder/file filters.
- [x] Sorting and cursor/infinite results.
- [x] Permission-aware result actions.
- [x] Debounced stale-request cancellation.
- [x] Admin owner filtering for workspace-aware search contexts.

## Phase 12 — Collections

**Status: ✅ DONE**

- [x] Collection list/create/rename/delete.
- [x] Collection detail and file membership.
- [x] Collection-only accessible files.
- [x] Permission-aware operations.
- [x] Collection membership does not imply structural folder access.

## Phase 13 — Sharing & ACL

**Status: ✅ DONE**

- [x] Folder/collection permissions UI.
- [x] User lookup/select.
- [x] Grant/update/revoke `view | edit | full`.
- [x] Effective/inherited permission presentation.
- [x] Owner/admin distinctions.
- [x] Access grants show display name with exact `@username` identity.
- [x] Shared-item owners show display name plus exact username.

## Phase 14 — Public shares

**Status: ✅ DONE**

- [x] Create/copy/open/revoke/regenerate public links.
- [x] Anonymous routes.
- [x] Public file download.
- [x] Public folder browsing.
- [x] Public collection rendering.
- [x] Revoked/not-found states.
- [x] Discord internals remain hidden.

Implemented historically as sub-batches **14A authenticated share management** and **14B anonymous viewer**.

## Phase 15 — Trash & restore

**Status: ✅ DONE**

- [x] Trash view.
- [x] File/folder trash actions.
- [x] Quota refresh after trash.
- [x] Restore destination/name-conflict handling.
- [x] Quota failure and nested-trash UX.
- [x] No misleading physical-delete guarantee in normal V1 UX.

## Phase 16 — Account & admin console

**Status: ✅ DONE**

- [x] Profile/security/password/MFA/account settings.
- [x] Admin users list/create/edit/role/enable-disable.
- [x] Temporary admin password create/reset flows.
- [x] User-selected real password remains strong after mandatory change.
- [x] Admin user avatars.
- [x] Audit events.
- [x] Jobs diagnostics.
- [x] Upload diagnostics.
- [x] Storage overview and quota reconciliation.
- [x] Admin-only management navigation.
- [x] Human identity presentation standardized to `name` + `@username` where relevant.
- [x] Technical UUIDs retained for filtering/debug/correlation.

Implemented historically as sub-batches **16A admin foundation** and **16B extended admin/diagnostics**.

## Phase 17 — UX, accessibility & resilience

**Status: ✅ DONE**

Phase 17 is now considered closed. The explicit UX-hardening completion landed before the later workspace/identity polish, and subsequent changes continued to improve the same release candidate rather than reopening the phase.

Completed areas include:

- [x] keyboard navigation and file-browser hotkeys;
- [x] focusable/accessible form controls and dialog primitives across critical flows;
- [x] mobile/responsive file browser and shell;
- [x] local loading states and route boundaries without normal full-page layout jumps;
- [x] request abort/timeout/stale-request control;
- [x] duplicate-submit protection on critical forms;
- [x] bounded thumbnail and preview preload queues;
- [x] large-list review with infinite loading and bounded queues; no virtualization added without evidence;
- [x] SelectGroup/SelectLabel normalization across the hardened UI areas;
- [x] command palette improvements;
- [x] official metadata/title/favicon and scaffold cleanup;
- [x] drag/drop overlay hardening and viewport-centered gated drop area;
- [x] upload manager usability improvements;
- [x] workspace-aware identity/navigation polish.

## Phase 18 — Testing, performance & web release stabilization

**Status: 🚧 CURRENT — FINAL FORMAL PHASE**

Phase 18 is now the only formal phase left.

The goal is **release certification**, not another broad feature-refactor phase.

Primary work:

- [ ] run/record complete unit/component/integration coverage;
- [ ] run browser E2E/smoke for critical happy paths;
- [ ] run API type drift verification;
- [ ] run lint/typecheck/production build;
- [ ] review bundle/client request waterfalls;
- [ ] run responsive/accessibility smoke matrix;
- [ ] verify upload persistence/resume/folder upload under representative conditions;
- [ ] verify admin cross-workspace routing and identity behavior;
- [ ] close or explicitly accept any failures found during release verification;
- [ ] declare Web V1 only after the evidence set is clean.

---

# 4. Current implemented checkpoint through Phase 17

## 4.1 Core product status

```text
Phase 0  ───────────────── Phase 16   ✅ complete
Phase 17                              ✅ complete
Phase 18                              🚧 current / final
```

At this checkpoint there is no planned feature phase after Phase 18.

## 4.2 Recent implemented delta after the previous plan snapshot

The previous plan snapshot was written before the following landed changes. These are now part of the current source-of-truth state.

### UX hardening completion

- [x] Phase 17 UX hardening completion.
- [x] additional Select/label accessibility normalization.
- [x] responsive header/control organization.
- [x] favorites workspace completion.

### Workspace-aware routing

- [x] owner-scoped workspace contracts.
- [x] `/{username}` becomes the canonical workspace route.
- [x] nested workspace routes include folders/files/search/favorites/collections/shared/trash.
- [x] app shell loads workspace owner/root/usage by username.
- [x] normal users are limited to their own workspace.
- [x] admins can load another user's workspace without impersonation.
- [x] workspace context is separate from authenticated actor/current-user context.

### Identity model

- [x] mutable display `name`.
- [x] immutable technical `username`.
- [x] login stays username-based.
- [x] exact routes/mentions remain username-based.
- [x] workspace labels/breadcrumbs prefer display name.
- [x] ACL/shared/admin identity surfaces use display name and retain `@username`.
- [x] inaccessible-workspace message uses `@username` rather than pretending a display name is known.

### Admin identity and credential UX

- [x] admin create/edit surfaces use display name correctly.
- [x] username is readonly technical identity in admin edit flows.
- [x] admin user avatars are displayed where available.
- [x] temporary admin create/reset passwords may be short temporary credentials.
- [x] mandatory user-selected replacement password remains strong.
- [x] audit actor identity is human-readable.
- [x] user audit-resource identity is human-readable while UUID remains available.
- [x] upload diagnostics show owner and actor `name · @username` plus technical UUIDs.
- [x] quota reconciliation returns/presents `name + @username`, before/after counters and repaired/over-quota status.

### Upload UX

- [x] folder-tree upload merge semantics.
- [x] existing-file skip behavior without overwriting.
- [x] file-vs-folder collision stays explicit.
- [x] Dropzone `./filename` normalization fix for single/multi-file upload.
- [x] upload manager replaced Sheet UI with full-page queue view.
- [x] floating Uploads control remains available while tasks exist.
- [x] upload queue provider remains above route transitions so in-progress tasks survive navigation.

### Folder size

- [x] browser API returns recursive logical folder size.
- [x] deleted descendants are excluded.
- [x] empty folder can display `0 B`.
- [x] list view displays folder size.
- [x] grid view displays folder size.
- [x] `sort=size` compares folder recursive size and file logical size consistently.

### Admin workspace switcher

- [x] admin directory-driven workspace selector mounted in app shell.
- [x] active users can be searched by name/username/role.
- [x] current workspace is marked.
- [x] admin-view badge distinguishes another user's workspace.
- [x] `Return to my workspace` action is available.
- [x] unsafe resource-specific suffixes reset when changing workspace.
- [x] workspace-level views can be preserved when switching owners.
- [x] request lifecycle bug that aborted the admin user-directory fetch was fixed.

### Actor-vs-workspace route bugfix

The route ownership rule is now explicit and implemented:

```text
workspace-scoped routes
→ use viewed workspace.username

actor/account/management-scoped routes
→ use authenticated user.username
```

This prevents an admin viewing `/mew` from accidentally navigating to `/mew/admin`, `/mew/settings` or `/mew/uploads` when those routes belong to the logged-in admin account.

## 4.3 Recent landed commits represented by this checkpoint

```text
28becc3  feat(web): complete phase 17 ux hardening
372d2d9  feat(web): add admin owner filtering to search
79ea2df  feat(api): add owner-scoped workspace contracts
0ae559b  feat(web): implement workspace-specific layouts and navigation
914c7b7  feat(users): add display names and make usernames immutable
913f386  feat(api): add workspace details endpoint
c13dacb  feat(api, web): workspace display name integration
119cbe7  feat(api, web): identity in access grants/shared items
ddfe7b5  fix(web): display name in workspace breadcrumb
3af3225  feat(admin): identity and temporary credentials
64360d4  feat(admin): upload diagnostics identity
d82faca  feat(admin): quota reconciliation reporting
4e2a140  feat(admin): audit user-resource identity
3daa0ff  fix(web): accept Dropzone relative upload paths
d45a99c  refactor(web): move upload manager to page
85991be  feat(nodes): recursive folder sizes
d4f941a  feat(web): expose admin workspace switcher
bdf686e  feat(web): improve admin workspace switching
d673312  fix(web): separate actor and workspace routes
```

---

# 5. Workspace and route ownership contract

This section is a permanent web-client routing rule.

## 5.1 Two identities exist at the same time

For an admin browsing another user's workspace:

```text
authenticated actor/current user = dev
viewed workspace owner           = mew
```

These values are intentionally different.

Do not collapse them into a single `username` concept.

## 5.2 Workspace-scoped routes

Only the **Workspace** sidebar group follows the viewed workspace owner.

```text
Files        /{workspace.username}
Search       /{workspace.username}/search
Favorites    /{workspace.username}/favorites
Collections  /{workspace.username}/collections
Shared       /{workspace.username}/shared
Trash        /{workspace.username}/trash
```

Folder/file deep links are also workspace-scoped:

```text
/{workspace.username}/folders/{folderId}
/{workspace.username}/files/{fileId}
```

When switching workspace owners, resource-specific IDs from the previous workspace must not be reused.

## 5.3 Actor/account/management-scoped routes

Routes outside the Workspace sidebar group follow the authenticated actor/current user:

```text
DisCloud home   /{user.username}
Admin           /{user.username}/admin
Diagnostics     /{user.username}/admin/diagnostics
Settings        /{user.username}/settings
Profile         /{user.username}/settings/profile
Security        /{user.username}/settings/security
Common          /{user.username}/settings/common
Uploads         /{user.username}/uploads
```

Example:

```text
login actor = dev
viewed workspace = mew

Files        → /mew
Search       → /mew/search
Admin        → /dev/admin
Diagnostics  → /dev/admin/diagnostics
Settings     → /dev/settings
Uploads      → /dev/uploads
```

## 5.4 Workspace switching preservation rules

Safe workspace-level views may be preserved:

```text
/search
/favorites
/shared
/trash
/collections  # collection detail collapses back to list
```

Unsafe/resource-specific or actor-specific routes reset to the selected workspace root:

```text
/folders/{id}
/files/{id}
/admin...
/settings...
/uploads...
```

This avoids carrying IDs or account-management context from one owner to another.

---

# 6. Identity presentation contract

## 6.1 Username

`username` is immutable technical identity.

Use it for:

- login;
- canonical workspace routes;
- exact `@username` references;
- technical account identity;
- disambiguation when display names collide.

## 6.2 Display name

`name` is mutable presentation identity.

Use it as the primary human-readable label for:

- workspace labels;
- breadcrumbs;
- admin user presentation;
- ACL grant presentation;
- shared owners;
- audit actors/user resources;
- upload diagnostic owner/actor presentation;
- quota reconciliation rows.

Recommended visual form where exact identity matters:

```text
Jane Doe
@jane
```

or compactly:

```text
Jane Doe · @jane
```

## 6.3 Technical UUIDs

UUIDs remain appropriate for:

- filters;
- diagnostics details;
- correlation/debug data;
- route resource IDs such as file/folder/collection IDs;
- API payloads that already use IDs.

Do not replace technical UUIDs with display strings in places where correlation is the purpose.

---

# 7. Upload behavior contract

## 7.1 Queue ownership

`UploadProvider` is app-level state and must survive navigation between workspace/account pages.

The upload queue is client ephemeral state; it is not a server-persisted UI task list.

## 7.2 Upload manager page

The floating button links to the actor-scoped page:

```text
/{user.username}/uploads
```

The page presents:

- Active / Failed / Complete / Total counters;
- cancel selected/all;
- retry selected/all failed;
- clear completed;
- file path when a relative folder path exists;
- progress bytes/percentage;
- visible error text.

The old Sheet presentation is no longer the canonical upload-manager UX.

## 7.3 Folder-tree upload

```text
local folder selection/drop
        ↓
normalize safe relative paths
        ↓
create/resolve server folder tree
        ↓
relative directory → folderId
        ↓
reuse resumable file upload pipeline
```

Merge semantics:

- existing folders are reused;
- missing folders are created;
- existing server-only descendants stay untouched;
- already-existing files can be skipped;
- file/folder structural collisions remain errors;
- leading Dropzone `./` is normalized once;
- `..`, empty unsafe segments and NUL remain rejected.

---

# 8. Phase 18 — current detailed release checkpoint

Phase 18 should be treated as **verification-first**. Do not start broad refactors just because the phase is named stabilization.

## 8.1 Required automated gate

From `web/`:

```bash
pnpm api:types:check
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

All five commands must pass on the release candidate.

## 8.2 Required backend companion gate

Although this is the web plan, release certification depends on a compatible backend candidate. At minimum run the backend test gate in the same checkpoint:

```bash
go test ./...
```

Race/fuzz/load/restore evidence remains tracked by the backend plan.

## 8.3 Critical browser/integration flows

### Setup/auth

- [ ] fresh setup with name + username + password;
- [ ] login by username;
- [ ] MFA challenge/recovery flow;
- [ ] display-name change does not change login username;
- [ ] expired/disabled session behavior;
- [ ] logout.

### Account/admin temporary credentials

- [ ] admin create user with a 1-character temporary password;
- [ ] user is forced through real password change;
- [ ] real/new password below 12 characters is rejected;
- [ ] admin reset password with a 1-character temporary password;
- [ ] subsequent login/change lifecycle works;
- [ ] immutable username remains unchanged when display name is edited.

### Workspace routing

Using admin `dev` and user `mew` as an example:

- [ ] login as `dev`;
- [ ] workspace switcher lists active users;
- [ ] select `mew` → route becomes `/mew`;
- [ ] `Admin view` indicator appears;
- [ ] Files/Search/Favorites/Collections/Shared/Trash use `/mew...`;
- [ ] Admin → `/dev/admin`;
- [ ] Diagnostics → `/dev/admin/diagnostics`;
- [ ] Settings/Profile/Security → `/dev/...`;
- [ ] Uploads → `/dev/uploads`;
- [ ] DisCloud logo/home → `/dev`;
- [ ] Return to my workspace → `/dev`;
- [ ] normal user cannot switch to another user's workspace.

### File browser

- [ ] own workspace root/nested folders;
- [ ] admin-viewed workspace root/nested folders;
- [ ] browser Back/Forward;
- [ ] breadcrumb root displays `${name}'s workspace` where applicable;
- [ ] list/grid modes;
- [ ] favorite/search actions;
- [ ] recursive folder size visible;
- [ ] empty folder displays `0 B`;
- [ ] nested folder size includes recursive descendants;
- [ ] trashed descendant does not count toward active folder size;
- [ ] size sorting works across file + folder items.

### Uploads

- [ ] single-file picker upload;
- [ ] multi-file picker upload;
- [ ] drag/drop single file;
- [ ] Dropzone path `./filename` succeeds;
- [ ] folder picker upload;
- [ ] nested dropped folder upload;
- [ ] merge into existing folder tree;
- [ ] existing file skip;
- [ ] file-vs-folder collision error;
- [ ] retry/cancel;
- [ ] navigate away while large upload is active;
- [ ] return to Uploads page and verify queue/progress did not reset.

### Preview/download

- [ ] normal download;
- [ ] Range-backed preview;
- [ ] image/video/audio/text/PDF supported flows;
- [ ] preview next/previous navigation;
- [ ] preload request count stays bounded;
- [ ] folder ZIP.

### ACL/shared/public

- [ ] grant/update/revoke access;
- [ ] identity displays `name` and `@username` correctly;
- [ ] shared owner presentation;
- [ ] public file/folder/collection share flows;
- [ ] revoked/not-found public link behavior.

### Trash/restore

- [ ] trash file/folder;
- [ ] quota refresh;
- [ ] restore;
- [ ] restore conflict flow;
- [ ] restore quota failure behavior.

### Admin console/diagnostics

- [ ] admin user avatars;
- [ ] user display names and immutable usernames;
- [ ] audit actor identity;
- [ ] audit user-resource identity;
- [ ] non-user audit resources stay technical;
- [ ] upload diagnostic owner identity;
- [ ] upload diagnostic actor identity;
- [ ] quota reconciliation result rows;
- [ ] repaired/over-quota status;
- [ ] Jobs diagnostics remain technical where human identity is not applicable.

## 8.4 Accessibility smoke

- [ ] keyboard-only navigation through shell and critical dialogs;
- [ ] visible focus where expected;
- [ ] dialog focus returns predictably;
- [ ] form labels associate with controls;
- [ ] status/error text is reachable to assistive technology;
- [ ] command palette and workspace switcher are keyboard usable;
- [ ] table/list actions have accessible names.

## 8.5 Responsive matrix

At minimum smoke:

```text
mobile narrow
mobile wide
small tablet
large tablet
laptop
wide desktop
```

Critical targets:

- sidebar open/collapsed/mobile overlay;
- command palette header layout;
- file browser list/grid;
- bulk-selection toolbar;
- upload page table horizontal overflow;
- admin dialogs/tables;
- workspace switcher popover.

## 8.6 Performance/request review

- [ ] representative image-heavy folder;
- [ ] representative deep folder tree with recursive sizes;
- [ ] infinite folder loading request pattern;
- [ ] bounded thumbnail request concurrency;
- [ ] bounded preview preload window;
- [ ] no duplicate admin user-directory fetch loop;
- [ ] no request abortion caused by state in an effect dependency loop;
- [ ] upload queue does not restart on navigation;
- [ ] bundle review finds no accidental large dependency regression.

## 8.7 Phase 18 exit gate

```text
[ ] OpenAPI generated types are in sync
[ ] unit/component/integration tests pass
[ ] lint passes
[ ] typecheck passes
[ ] production build passes
[ ] critical browser smoke passes
[ ] admin workspace route ownership passes
[ ] upload single/multi/folder flows pass
[ ] recursive folder-size behavior passes
[ ] accessibility smoke passes
[ ] responsive smoke passes
[ ] request/performance review has no release blocker
[ ] known failures are fixed or explicitly accepted
[ ] Web V1 release checklist is signed off
```

Only after this gate is clean should the plan state:

> **Web V1 release-ready.**

---

# 9. Cross-cutting implementation rules

## 9.1 API/data

- Backend OpenAPI is the contract source of truth.
- Do not invent web-only backend semantics.
- Reuse shared API helpers instead of raw scattered fetches.
- Session cookie is canonical auth state.
- No auth tokens in localStorage/sessionStorage.

## 9.2 Identity

- `name` is presentation.
- `username` is immutable technical identity.
- Login and canonical workspace route use username.
- Exact identity should remain available as `@username` when display name is shown.

## 9.3 Actor vs workspace

- `useCurrentUser()` represents authenticated actor/account context.
- `useWorkspace()` represents the currently viewed workspace owner context.
- Do not use `workspace.username` for account/management routes.
- Do not use `user.username` for workspace navigation that intentionally follows the viewed owner.

## 9.4 State

Prefer:

1. URL state for navigation/filter/sort/pagination;
2. local React state for transient component state;
3. Context for genuinely app-level ephemeral state.

Upload queue remains an accepted app-level Context because uploads survive route navigation.

## 9.5 UI implementation priority

1. Existing shared DisCloud helper/component.
2. Existing `web/src/components/ui` primitive.
3. Official shadcn/ui component.
4. Configured registry component.
5. Mature dedicated library.
6. Browser/React/Next native API.
7. Minimal custom glue.

## 9.6 Shared helper rule

When a helper with matching semantics already exists, import/reuse it. Do not create local duplicates unless semantics are genuinely different.

## 9.7 Select convention

```tsx
<SelectContent>
  <SelectGroup>
    <SelectLabel>Meaningful group</SelectLabel>
    <SelectItem value="..." />
  </SelectGroup>

  <SelectSeparator />

  <SelectGroup>
    <SelectLabel>Another group</SelectLabel>
    <SelectItem value="..." />
  </SelectGroup>
</SelectContent>
```

Use `SelectSeparator` only when separating meaningful semantic groups.

## 9.8 Request lifecycle

- Abort stale requests intentionally.
- Do not place a request's own presentation state in an effect dependency set if changing that state immediately triggers cleanup/abort.
- Distinguish expected client aborts from true backend/network failures.
- Prevent duplicate submits on mutation forms.

---

# 10. Current release answer

```text
19 total formal web phases

Phase 0  ─────────────── Phase 16   ✅ complete
Phase 17                             ✅ complete
Phase 18                             🚧 current / final
```

The correct high-level statement is:

> **The DisCloud web client has completed formal implementation through Phase 17. All major workspace, identity, admin, upload and file-browser features discussed through the current checkpoint are implemented on `main`. Phase 18 is now the only remaining formal phase and should focus on release verification, performance/request review, accessibility/responsive smoke and final build/type/API-contract gates.**

---

# 11. Source/checkpoint note

This file was updated from:

- the existing `docs/WEB_CLIENT_IMPLEMENTATION_PLAN.md` on `main`;
- the original formal 19-phase web roadmap;
- current `main` commits through **2026-08-21**;
- current source for workspace routing, app shell, workspace switcher, upload manager and file browser.

Update this plan whenever:

1. a Phase 18 gate is completed;
2. a release-blocking bug is found/fixed;
3. route ownership or identity invariants change;
4. Web V1 is formally accepted and Phase 18 can be marked ✅ DONE.

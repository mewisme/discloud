# DisCloud Web Client Implementation Plan

> Standalone source-of-truth roadmap for the DisCloud web client.
>
> Corrected checkpoint: **2026-08-20**
>
> Repository: `mewisme/discloud` · branch `main`
>
> Current formal phase: **Phase 17 — UX, accessibility & resilience**
>
> Final remaining formal phase: **Phase 18 — Testing, performance & web release stabilization**
>
> Total: **19 phases, numbered Phase 0 through Phase 18**.

## 1. Correction

The previous generated version of this file was incorrect because it reconstructed phase numbers from commit history. The original project conversation explicitly defines **19 web phases**, numbered **0–18**. Implementation labels such as `14A/14B` and `16A/16B` are sub-batches inside their parent phase; they do not change the formal roadmap numbering.

This corrected file is based on the exported conversation `ChatGPT-DisCloud new version-20260820-0721.md` plus the later current-conversation work through the present Phase 17 checkpoint.

## 2. Milestones and current status

| Milestone | Phases | Status |
| --- | --- | --- |
| MVP usable | Phase 0 → 10 | ✅ DONE |
| Collaboration complete | Phase 11 → 15 | ✅ DONE |
| Self-host management complete | Phase 16 | ✅ DONE |
| Web V1 | Phase 17 → 18 | 🚧 IN PROGRESS |

Current count:

- **Phase 0–16:** complete.
- **Phase 17:** current/in progress.
- **Phase 18:** pending and is the final formal phase.
- Counting the current unfinished phase, **2 phases remain to close Web V1**.
- After Phase 17 closes, **1 formal phase remains**.

## 3. Formal roadmap

### Phase 0 — Web architecture & conventions

**Status: ✅ DONE**

- Freeze `web/src/` structure.
- Define Server Component vs Client Component conventions.
- Route groups for public/auth/app/admin.
- Error/loading/not-found boundaries.
- Naming, import rules and component ownership.
- Reuse existing UI primitives before creating new components.
- Do not add Redux/Zustand/TanStack Query without a real need.
- Exit: later features do not invent independent architecture patterns.

### Phase 1 — Environment & API foundation

**Status: ✅ DONE**

- Server/browser environment strategy and API base URL.
- Typed fetch wrapper with session cookies.
- Parse `application/problem+json` into a unified `APIError`.
- Timeout/AbortController support.
- JSON/query/download/binary helpers.
- Keep backend secrets server-only.
- Exit: later API calls use one common client layer.

### Phase 2 — API contracts & client models

**Status: ✅ DONE**

- Generate/map OpenAPI schemas to TypeScript.
- Setup/auth/user/node/file/upload/share/collection/search models.
- Cursor pagination and `view | edit | full` permission models.
- Problem/error mapping.
- Do not invent client-only API response fields.
- Exit: OpenAPI is the web client's contract source of truth.

### Phase 3 — First-install setup

**Status: ✅ DONE**

- Setup status check and fresh-install redirect.
- First-admin form and validation.
- Concurrent setup conflict handling.
- Initialized installations cannot run setup again.
- Exit: a fresh deployment can bootstrap entirely through the web UI.

### Phase 4 — Authentication & session

**Status: ✅ DONE**

- Login/logout.
- Current session/current user bootstrap.
- Protected routes and guest/auth redirects.
- Disabled/expired session handling and app-wide 401 handling.
- Cookie auth only; no localStorage/sessionStorage auth token.
- Exit: refresh restores the correct authentication state.

### Phase 5 — MFA

**Status: ✅ DONE**

- MFA login challenge, TOTP and recovery-code login.
- Enable MFA and QR/secret enrollment.
- Verification and recovery-code UX.
- Disable/regenerate flows when supported by backend.
- Never persist MFA secrets/recovery codes in browser storage.
- Exit: complete MFA lifecycle is usable from the web UI.

### Phase 6 — Application shell

**Status: ✅ DONE**

- Main layout, sidebar, header and user menu.
- System/light/dark theme.
- Responsive/mobile navigation.
- Files/Favorites/Collections/Shared/Trash/Admin navigation.
- Quota/storage indicator and global toast/dialog system.
- Exit: stable authenticated application shell.

### Phase 7 — Folder navigation & file browser

**Status: ✅ DONE**

- Root and nested-folder navigation.
- Breadcrumbs, list/grid view, sorting and pagination.
- File/folder icons, MIME/category and size/date formatting.
- Empty/loading/error states.
- Deep-linkable folder URL.
- Exit: user can browse all accessible folder-tree content.

### Phase 8 — Node operations

**Status: ✅ DONE**

- Create folder, rename and move.
- Multi-select and batch actions when supported.
- Favorite/unfavorite.
- Permission-aware action menus.
- Safe optimistic UI only where rollback is trivial.
- Name-conflict and cross-owner restriction UX.
- Exit: file manager is usable for everyday organization.

### Phase 9 — Upload system

**Status: ✅ DONE**

- File picker and drag/drop.
- Create upload sessions, client chunking and SHA-256.
- Upload parts with bounded concurrency.
- Per-file/aggregate progress.
- Retry, cancel, resume and finalize.
- Quota/conflict handling.
- Upload manager survives route navigation.
- Exit: small/large/multi-file upload is stable.

### Phase 10 — File viewing & downloads

**Status: ✅ DONE**

- File detail and direct download.
- Content disposition and Range-aware media delivery.
- Image/video/audio/text preview.
- Unsupported-file fallback.
- Folder ZIP download.
- Metadata pending/ready/failed states.
- Exit: user can consume or download every valid stored file.

### Phase 11 — Search

**Status: ✅ DONE**

- Global search with URL-synced query.
- Type/category/folder/file filters and sorting.
- Cursor pagination/infinite results.
- Permission-aware results and result actions.
- Debounce and cancel stale requests.
- Exit: user can find content without manually browsing the folder tree.

### Phase 12 — Collections

**Status: ✅ DONE**

- Collection list/create/rename/delete.
- Collection detail and add/remove files.
- Open collection-only accessible files.
- Permission-aware operations.
- Collection membership must not imply parent-folder access.
- Exit: collections work as logical grouping separate from the folder tree.

### Phase 13 — Sharing & ACL

**Status: ✅ DONE**

- Folder and collection permissions UI.
- User lookup/select.
- Grant/update/revoke `view | edit | full`.
- Inheritance/effective-permission presentation.
- Owner/admin distinctions.
- Do not offer actions the backend will definitely reject.
- Exit: collaboration can be configured entirely through the web UI.

### Phase 14 — Public shares

**Status: ✅ DONE**

- Create public file/folder/collection links.
- Copy/open/revoke/regenerate.
- Anonymous public routes.
- Public file download, folder browsing and collection rendering.
- Revoked/not-found states.
- Do not expose Discord locator/CDN internals.
- Exit: public sharing works without an authenticated session.

### Phase 15 — Trash & restore

**Status: ✅ DONE**

- Trash view and file/folder trash operations.
- Quota update after trash.
- Restore with destination/name conflict handling.
- Quota failure and nested-trash semantics.
- No Empty Trash/permanent-delete UX in V1.
- Exit: complete soft-delete lifecycle is available in the web UI.

### Phase 16 — Account & admin console

**Status: ✅ DONE**

- Profile/security/password/MFA/quota usage.
- Admin users list/create/role/enable-disable/password reset/quota.
- Audit events, jobs and upload diagnostics.
- Storage overview/reconciliation and useful metrics.
- Admin navigation only for admins.
- Exit: self-host instance can be managed without manual API calls.

### Phase 17 — UX, accessibility & resilience

**Status: 🚧 IN PROGRESS**

- Keyboard navigation and focus management.
- Accessible dialogs/forms.
- Mobile/responsive file browser.
- Skeleton/loading behavior without layout jumps.
- Error recovery and offline/network-loss messaging.
- Abort stale requests and prevent duplicate submit.
- Large-list rendering review.
- System/light/dark theme.
- Official metadata/title/favicon and no Create Next App scaffold.
- Exit: UI no longer feels like scaffold/dev tooling.

### Phase 18 — Testing, performance & web release stabilization

**Status: ⏳ PENDING**

- Unit tests for API/error utilities.
- Component tests for critical forms.
- Integration flows for setup, login/MFA, browse, upload, download, ACL, collections, shares, trash/restore and admin.
- Browser E2E for important happy paths.
- `pnpm lint`, typecheck and production build.
- Bundle and client-request-waterfall review.
- Accessibility and responsive smoke testing.
- CI release gate and final OpenAPI drift check.
- Exit: web client is stable enough to be called Web V1.

## 4. Checked implementation status through Phase 16

The conversation progression and implementation history have already passed the exit point of every formal phase from 0 through 16:

- [x] **Phase 0 — Web architecture & conventions**
- [x] **Phase 1 — Environment & API foundation**
- [x] **Phase 2 — API contracts & client models**
- [x] **Phase 3 — First-install setup**
- [x] **Phase 4 — Authentication & session**
- [x] **Phase 5 — MFA**
- [x] **Phase 6 — Application shell**
- [x] **Phase 7 — Folder navigation & file browser**
- [x] **Phase 8 — Node operations**
- [x] **Phase 9 — Upload system**
- [x] **Phase 10 — File viewing & downloads**
- [x] **Phase 11 — Search**
- [x] **Phase 12 — Collections**
- [x] **Phase 13 — Sharing & ACL**
- [x] **Phase 14 — Public shares** — implemented as sub-batches **14A authenticated share management** and **14B anonymous viewer**.
- [x] **Phase 15 — Trash & restore**
- [x] **Phase 16 — Account & admin console** — implemented as sub-batches **16A admin foundation** and **16B extended admin/diagnostics**.

### Important Phase 9 carry-over — resolved during Phase 17

The Web V1 folder-tree upload carry-over is implemented. Local relative paths are preserved, the backend batch-folder primitive is used to create or resolve nested folders, and each file is routed to its resolved destination folder.

Folder uploads use merge semantics:

- Existing folders at the same relative path are reused rather than treated as failures.
- Missing folders and subtrees are created.
- Existing server-only children remain untouched.
- Files already present at the same resolved path are skipped.
- File-vs-folder structural collisions remain explicit conflicts rather than being silently skipped.
- Existing resumable upload/chunk concurrency remains the file-transfer mechanism after folder resolution.

The original Phase 9 exit criteria explicitly covered small/large/multi-file upload, and that phase is therefore considered closed. However, the broader product requirements also expect **complete local folder-tree upload**. The current web uploader still maps each selected `File` to one destination `folderId`; it does not yet preserve `webkitRelativePath`/relative paths and recreate the nested tree.

Treat folder-tree upload as a **Web V1 carry-over/blocker** to close before Phase 18 is finished:

```text
local folder picker / dropped folder
        ↓
read relative paths
        ↓
create/resolve server folder tree
        ↓
map relative directory → folderId
        ↓
reuse current resumable UploadProvider for each file
```

## 5. Phase 17 — current detailed checkpoint

### 5.1 Original Phase 17 checklist

- [x] **Keyboard navigation** — File-browser hotkeys, keyboard selection/actions, parent navigation and command palette have been implemented.
- [~] **Focus management** — Critical flows are improved, but an app-wide focus audit is still required before Phase 17 can be closed.
- [~] **Accessible dialogs/forms** — Auth/settings/access dialogs use accessible primitives; final accessibility audit remains.
- [x] **Mobile/responsive file browser** — Responsive browser, compact actions and dock behavior have been implemented.
- [x] **Skeleton/loading behavior** — Route boundaries and local browser loading overlays avoid normal full-page layout jumps.
- [x] **Error recovery** — Route error/not-found states, search recovery, upload errors and preview/thumbnail retry states exist.
- [~] **Offline/network-loss messaging** — Request resilience exists, but explicit app-wide offline-state UX has not been formally closed.
- [x] **Abort stale requests** — Search cancellation, request timeout/abort foundation and preload-window management are implemented.
- [x] **Prevent accidental duplicate submit** — Setup/forms and queued-upload duplicate protections cover the main cases.
- [~] **Large-list rendering review** — Infinite folder loading, bounded thumbnail queue and bounded preload queue are in place; final perf/virtualization decision belongs to the Phase 17/18 boundary.
- [x] **Dark/light/system theme** — Completed from the foundation phases.
- [x] **Application metadata/title + remove scaffold** — These Phase 17 bullets were pulled forward and completed in Phase 0.

### 5.2 Phase 17 refinement already completed

- [x] Client-side folder transitions with deep-link + browser Back/Forward support.
- [x] Infinite folder scrolling, parent `..`, breadcrumb compaction and mobile actions.
- [x] Double-click row/card navigation and compact grid redesign.
- [x] Multi-select, bulk file-browser actions and context menus.
- [x] Additional keyboard shortcuts and selection feedback.
- [x] File Browser toolbar configuration: inline, bottom dock, right dock.
- [x] Bottom browser dock remains below the independent multi-select toolbar.
- [x] File Browser drag-and-drop feedback is viewport-bounded: the active drop overlay follows only the currently visible browser area instead of expanding with long file lists.
- [x] Thumbnail retry/load hardening and bounded thumbnail load queue with tests.
- [x] Preview carousel using the existing carousel/Embla stack.
- [x] Only the current full preview is rendered; inactive slides remain lightweight.
- [x] Previous/next preview navigation with route replacement.
- [x] Auto-hide preview info with interaction/navigation reveal behavior.
- [x] Common user settings for timezone, toolbar configuration and preview preload count.
- [x] Preview preload count defaults to 3 and is user-selectable from 3–5.
- [x] Sliding preload window: moving one item adds only the new tail item.
- [x] Warm/warming dedupe and bounded speculative preload concurrency.
- [x] Image full preload, video/audio metadata preload and PDF/text initial Range warm.
- [x] LineNav for multi-section settings pages.
- [x] SelectGroup + SelectLabel convention; SelectSeparator only between meaningful semantic groups.
- [x] Command palette/navigation improvements.
- [x] File Browser drag-and-drop feedback uses a full-AppShell viewport overlay with an explicitly viewport-centered gated drop zone and subtle active-state scaling.
- [x] Advanced upload-manager UX: compact table, task multi-select, cancel selected/all, retry selected/all failed, clear finished tasks and active/error/skipped counters.
- [x] Folder-tree upload preserves relative paths, merges existing directory structure, creates missing descendants and skips already-present files without overwriting.

### 5.3 Remaining Phase 17 backlog

- [ ] Final app-wide focus-management pass, including focus restore after dialogs and keyboard order.
- [ ] Final accessible-dialog/form and screen-reader announcement pass.
- [ ] Explicit offline/network-loss messaging where it improves recovery.
- [ ] Final large-list strategy review; add virtualization only if representative data proves it is needed.
- [ ] Normalize remaining Select usages to SelectGroup/SelectLabel conventions.

### 5.4 Phase 17 exit gate

```text
[ ] critical workflows are keyboard usable
[ ] focus behavior is consistent
[ ] dialogs/forms pass final accessibility review
[ ] responsive/mobile file browser is stable
[ ] loading/error/offline states are coherent
[ ] stale/duplicate requests are controlled
[ ] large-list strategy is reviewed
[ ] remaining carry-overs have explicit disposition
[ ] UI no longer has scaffold/dev-tool feel
```

## 6. Phase 18 — final phase

**Status: ⏳ PENDING AS A FORMAL PHASE**

Some Phase 18 foundations were pulled forward (Vitest, utility tests, type drift checks, lint/typecheck/build discipline, route boundaries), but the formal stabilization phase is not closed.

Planned release gate:
- [ ] Unit tests for API/error/navigation/queue utilities.
- [ ] Component tests for critical forms.
- [ ] Integration coverage: setup, login/MFA, browse, upload, download, ACL, collections, shares, trash/restore and admin.
- [ ] Browser E2E for important happy paths.
- [ ] Representative folder/image-heavy performance test.
- [ ] Preview carousel/preload request-waterfall test.
- [ ] Upload concurrency/resume test.
- [ ] Bundle review.
- [ ] Client request-waterfall review.
- [ ] Accessibility smoke test.
- [ ] Responsive matrix.
- [ ] Offline/network-failure smoke.
- [ ] `pnpm test`.
- [ ] `pnpm api:types:check`.
- [ ] `pnpm lint`.
- [ ] `pnpm typecheck`.
- [ ] `pnpm build`.
- [ ] CI release gate.
- [ ] Final OpenAPI drift verification.
- [ ] Web V1 release checklist.

## 7. Cross-cutting rules

### API/data

- Backend OpenAPI remains the source of truth.
- Do not invent client-only API/domain semantics.
- Session cookies remain the canonical auth state.
- Do not store authentication tokens in browser storage.
- Reuse shared API helpers instead of scattering raw backend fetch calls.

### State

Prefer URL state for navigation/filter/sort/pagination, local React state for transient UI, and Context only for genuinely app-wide ephemeral state. Add a state library only when those are insufficient. Upload manager is an accepted app-level exception because uploads survive navigation.

### UI implementation priority

1. Existing shared DisCloud helper/component.
2. Existing `web/src/components/ui` primitive.
3. Official shadcn/ui component.
4. Suitable configured registry component.
5. Mature dedicated library.
6. Browser/React/Next native API.
7. Minimal custom glue.

### Select convention

```tsx
<SelectContent>
  <SelectGroup>
    <SelectLabel>Meaningful group</SelectLabel>
    <SelectItem value="..." />
  </SelectGroup>

  {/* only when there is another semantic group */}
  <SelectSeparator />

  <SelectGroup>
    <SelectLabel>Another group</SelectLabel>
    <SelectItem value="..." />
  </SelectGroup>
</SelectContent>
```

## 8. Current answer

```text
19 total web phases
Phase 0  ─────────────── Phase 16   ✅ complete
Phase 17                             🚧 current
Phase 18                             ⏳ final
```

We are currently implementing **Phase 17**. There is **one formal phase after it, Phase 18**. Counting the unfinished current phase, **two phases remain to close Web V1**.

## 9. Source/checkpoint note

The formal 19-phase roadmap comes from the exported conversation at the point where the user asked to list all web phases. Later conversation confirms the milestone grouping: Phase 0–10 MVP, Phase 11–15 collaboration, Phase 16 self-host management, and Phase 17–18 Web V1. Current Phase 17 status additionally includes the post-export work in this conversation: browser hardening, thumbnail queue, hotkeys, preview carousel, LineNav/settings, configurable preview preload and sliding preload management.

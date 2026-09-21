# Eco Aware — plain HTML / CSS / JavaScript

No build tools, no npm, no framework. Every page in this folder is **self-contained**:
its CSS and JavaScript are inlined into the `.html` file itself.

## How to run it

Double-click **`index.html`** — or double-click any single page, e.g. `reporter-login.html`.
Each one renders fully styled on its own, even straight out of the zip, with no server
and no `css/` or `js/` folder next to it.

The links between pages (`role.html`, `reporter-login.html`, `report.html?id=…`) work as
long as the files sit in the same folder, which they do here.

## Sign-in is required

Every app page (Home, Report, My Reports, the report-detail pages, Feedback, Dashboard,
Staff) checks for a session before rendering anything, and sends you to Select Your Role
if you're signed out. There's no way to reach the dashboard without logging in.

## Pages

**Sign-in flow** — `role.html` (start here) → `reporter-login.html` /
`profile.html` → `management-login.html`, `staff-login.html` ·
`reporter-signup.html` → `reporter-verify.html`

**App** — `index.html` (home) · `report.html` (file a report) · `reports.html` (my reports) ·
`report-pending.html`, `report-inprogress.html`, `report-resolved.html` (detail views) ·
`feedback.html` · `dashboard.html` · `staff.html`

**Static** — `about.html` · `contact.html` · `legal.html`

## Accounts

There is no backend, so accounts live in the browser (`localStorage`).

Every role has one fixed demo account, shown as a dismissible hint on its login page:

| Role | Login | Password |
| --- | --- | --- |
| Reporter | `alex@university.edu` | `Reporter@123` |
| Management | `manager@ecoaware.org` | `Manager@123` |
| Staff | `staff.id@ecoaware.org` (or `ea-staff-001`) | `Staff@123` |

Reporter also has a real sign-up — create your own account with Sign Up, then log in with it.
The verification step doesn't send an actual email; the code is shown on screen so you can
complete sign-up. Management and Staff have no sign-up flow (those accounts are meant to be
issued by the sustainability office), so their demo account is the only way in for now.

There are no sample/demo reports — My Reports starts empty until a report is actually
submitted through `report.html`, and it's saved for real (in `localStorage`) from then on.

## `eco-aware-single-file.html`

The same app as **one** file — all 19 pages, with a small router that swaps them in
when you click a link. Handy for sharing or uploading somewhere as a single upload.

## Editing

Because the CSS and JS are inlined, a shared change (a colour token, the header, the
floating camera button) now has to be made in each page that uses it. The design tokens
sit in the `:root { … }` block at the top of every `<style>`; the shared markup —
header, breadcrumb, bottom nav, footer — is drawn by `renderShell()` / `renderAuthShell()`
inside the script blocks. There is still exactly one camera-button definition per page,
inside `renderBottomNav()`.

Auth logic (sessions, sign-up, the management/staff demo accounts) lives in one place —
`Auth` — near the top of every auth page's script block; `Auth.requireSession()` is the
guard every app page calls before rendering.

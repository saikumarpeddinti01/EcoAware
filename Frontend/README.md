# Eco Aware — plain HTML / CSS / JavaScript (connected to the backend)

No build tools, no framework. Each page's CSS and page-specific JS are inlined; the handful of
values every page needs — the backend's URL and the category-name mapping — live in one shared
file, `shared/config.js`, loaded via a plain `<script src>` tag. Change the backend's address or
add a category once, there, instead of hunting through every page for a copy of the same constant.

## How to run it

1. Start the backend (`npm run dev` in the backend folder).
2. Serve this folder on **port 5173** — the backend only accepts requests from
   `http://localhost:5173` (`CLIENT_URL` in the backend `.env`). Do NOT double-click the HTML files;
   a page opened from disk is blocked by the browser.

   ```
   python -m http.server 5173
   ```
   (or `npx serve -l 5173`)
3. Open `http://localhost:5173/role.html`.

## Accounts (all real, stored in the backend database)

| Role | How you get one |
| --- | --- |
| Reporter | Sign up on `reporter-signup.html` |
| Management | `npm run seed:admin` in the backend (uses `SEED_ADMIN_*` from `.env`) |
| Staff | Created by management: `POST /api/users` with `role: "staff"` and a `departmentId` |

The login pages do not show demo credentials any more: sign in with real accounts created as described above.

## Pages

**Sign-in flow** — `role.html` → `reporter-login.html` / `profile.html` → `management-login.html`, `staff-login.html` · `reporter-signup.html` → `reporter-verify.html`

**Reporter app** — `index.html` (home) · `report.html` (file a report) · `reports.html` (my reports) ·
`report-pending.html`, `report-inprogress.html`, `report-resolved.html` (details) · `feedback.html`

**Management portal — `dashboard.html`** (uses `/api/manage/*`)
Dashboard · All reports · Assignments (review & assign) · Monitoring · Resolution review · Status history · Report detail

**Staff portal — `staff.html`** (uses `/api/staff/*`)
Dashboard · Incoming reports (review & take a report) · Assignments (start work, submit the fix with photos) · Resolved · Team

Both portals are single pages with their own menu (`#/dashboard`, `#/reports`, …). Each checks the
signed-in role first: a reporter opening `dashboard.html` is sent to `index.html`, and so on.

**Static** — `about.html` · `contact.html` · `legal.html`

On `contact.html`, fill in your real email, phone, office and hours in the `CONTACT` block near the bottom of the file. Anything left empty is simply not shown.

## Things that work now

- `feedback.html` sends `POST /api/feedback` (stored anonymously).
- `report.html` asks the browser for the user's location and sends `latitude` / `longitude`, plus an optional typed place (`location`). If GPS is blocked, the user must type where the issue is.
- The header and bottom bar depend on the role: reporters never see links to the staff or management portals.

## What is still not connected

- The "Your Eco-Impact" card on the home page shows the signed-in user's own report counts (there is no campus-wide endpoint yet).
- "Forgot password": there is no reset endpoint, so the login page tells people to contact the sustainability office.
- The language button (EN) is only a placeholder.

## Before you go live

1. Change `API_BASE` (one line near the top of each page's script) from `http://localhost:5000/api` to your real API address.
2. Set `CLIENT_URL` in the backend `.env` to the address the front end is served from.
3. Fill in `CONTACT` in `contact.html`.
4. Use a fresh `JWT_SECRET`, and keep `.env` out of git and out of zip files you share.

## Editing

Shared parts (colors, layout, the portal helpers) are copied into each portal page, so a change to them has to be made in
both `dashboard.html` and `staff.html`. All text that comes from the server is passed through `esc()` before it is shown.
Auth (`Auth`, `apiFetch`, the session in `localStorage`) is the same block in every page.

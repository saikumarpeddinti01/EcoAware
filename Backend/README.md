# Eco Ware - Backend

Node.js + Express + PostgreSQL (Supabase) API for the Eco Ware campus issue-reporting platform.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `JWT_SECRET`.
3. In Supabase SQL Editor run, in order: `database/schema.sql`, `stage2_migration.sql`, `stage3_migration.sql`, `stage4_migration.sql`, `stage4b_migration.sql` (skip any you already ran; each is safe to run twice).
4. Photo storage: put `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` (Supabase -> Project Settings -> API), then `npm run setup:storage` to create the `report-photos` bucket.
   The service_role key is a secret. It stays in the backend `.env` and must never reach the front end or GitHub.
5. `npm run seed:admin` (creates the first management account from `SEED_ADMIN_*` in `.env`)
6. `npm run dev`

## Auth API (Stage 2)

Base URL: `http://localhost:5000/api`. All bodies are JSON. Protected routes need the header
`Authorization: Bearer <token>`.

Every error looks like `{ "success": false, "message": "...", "errors": { "field": "..." } }`.

| Method | Route                   | Who               | Body                                                                | Result                                           |
| ------ | ----------------------- | ----------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| POST   | `/auth/signup`          | public (reporter) | `email, username, phone?, password`                                 | 201 `{ requiresVerification, email, reference }` |
| POST   | `/auth/verify-email`    | public            | `email, code`                                                       | 200 `{ token, user }`                            |
| POST   | `/auth/resend-code`     | public            | `email`                                                             | 200 (60s cooldown)                               |
| POST   | `/auth/login`           | public            | `email` or `identifier`, `password`, `portal?`                      | 200 `{ token, user }`                            |
| GET    | `/auth/me`              | logged in         | -                                                                   | `{ user }`                                       |
| POST   | `/auth/change-password` | logged in         | `currentPassword, newPassword`                                      | 200                                              |
| POST   | `/users`                | management        | `email, username, phone?, password, role` (`staff` or `management`) | 201                                              |
| GET    | `/users?role=staff`     | management        | -                                                                   | `{ users }`                                      |

**Notes for the front end**

- `portal` is `"reporter"`, `"staff"` or `"management"`, depending on which login page was used. The API rejects the login (403) if the account's role doesn't match.
- Staff login accepts a username or an email in `identifier`.
- Login returns 403 with `requiresVerification: true` if the reporter hasn't verified yet. Send them to the code screen.
- `reference` from signup is the "My Reference Code" (e.g. `REF-7E961A`) shown on the verify screen.
- Password rules: 8-72 characters, letters and numbers.
- In development with no SMTP set, the 6-digit code is printed in the server console and returned as `devCode`.
- Store the token (e.g. localStorage) and send it on every protected request.

## Reports API (Stage 3)

| Method | Route                                | Who                               | Notes                                                                                            |
| ------ | ------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/reports`                           | reporter                          | multipart/form-data: `category, description, photos (1-5 images), latitude?, longitude?, title?` |
| GET    | `/reports/mine?status=&page=&limit=` | reporter                          | list + status counts + pagination                                                                |
| GET    | `/reports/:id`                       | owner reporter, staff, management | `:id` = UUID or code like `EA-2026-0001`. Includes photos, `steps` timeline, `resolution`        |
| PATCH  | `/reports/:id`                       | owner reporter                    | only while `Pending`                                                                             |
| DELETE | `/reports/:id`                       | owner reporter                    | only while `Pending`; also deletes the photos from storage                                       |

Photos are verified by their real bytes (JPG/PNG/WebP, max 5 MB each, max 5 per report), stored in Supabase Storage under
`reports/<reportId>/<uuid>.<ext>`, and if saving to the database fails the uploaded files are removed again.
Set `STORAGE_DRIVER=local` to save to `./uploads` instead (offline development only).

Stage 4 additions to the reports API:

- `location` (optional text, e.g. `Science Building - Room 303`) can be sent with `POST /reports`.
- Staff and management can also file a report (`POST /reports`), e.g. the "Create staff report" button.
- `GET /reports/:id` now also returns `location` and `estimatedCompletion` (the due date, once assigned).
  Staff and management additionally get `workflowState`, `priority`, `department`, `evidenceComplete`, `technicianUpdate`, `reviewNote`.

The front-end team should read `FRONTEND_GUIDE.md`.

## How a report moves (Stage 4)

```
new --(management assigns / staff claims)--> assigned --(staff starts)--> in_progress
                                                 \                             |
                                                  \-------(staff submits)------+--> pending_review
                                                                                     |            |
                                                                          approve    |            | request more info
                                                                                     v            v
                                                                                 resolved     in_progress
```

- `reports.workflow_state` is what staff and management work with. Every change goes through `src/utils/workflow.js`, which rejects impossible moves with `409`.
- `reports.status` is what the reporter sees (`Pending` / `In Progress` / `Resolved`) and is always derived from the state. So the reporter screens did not change.
- Changes lock the report row, so if two staff claim the same report at the same moment, one wins and the other gets `409`.

## Staff API (Stage 4) base `/api/staff`

Reading: staff and management. Changing: staff only.

| Method | Route                                                                                              | Notes                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/staff/dashboard`                                                                                 | tiles (incoming / in progress / resolved today / assigned to you) + 5 recent incoming                    |
| GET    | `/staff/reports/incoming?category=&priority=&search=&from=&to=&sort=newest\|priority&page=&limit=` | reports nobody owns yet (their department's, or unrouted)                                                |
| POST   | `/staff/reports/:id/claim`                                                                         | body `{ dueDate?, priority? }`; takes the report as their own task                                       |
| GET    | `/staff/assignments?tab=active\|overdue\|completed`                                                | my tasks + stats (active, overdue, avg hours, SLA %) + tab counts                                        |
| POST   | `/staff/reports/:id/start`                                                                         | body `{ note? }`; only the assignee                                                                      |
| POST   | `/staff/reports/:id/resolution`                                                                    | multipart: `note` (10-2000), `photos` (0-5 "after" images, at least one overall); sends it to management |
| GET    | `/staff/reports/resolved?days=30&mine=true&category=&search=`                                      | resolved list + stats                                                                                    |
| GET    | `/staff/team`                                                                                      | staff members, department, active load, resolved this month                                              |
| GET    | `/departments`                                                                                     | id + name, for dropdowns                                                                                 |

## Management API (Stage 4) base `/api/manage` (management only)

| Method | Route                                                                                                               | Notes                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/manage/dashboard`                                                                                                 | open / assigned / in progress / resolution rate (30 days), median days, reports by category %, 5 recent                                                                                        |
| GET    | `/manage/reports?status=&category=&priority=&departmentId=&assignedTo=&overdue=true&search=&from=&to=&page=&limit=` | "All reports". `status` = `new`, `assigned`, `in_progress`, `pending_review`, `resolved` or `all`. Also gives `counts` per state for tab badges. The review queue is `?status=pending_review`. |
| POST   | `/manage/reports/:id/assign`                                                                                        | body `{ departmentId, dueDate: "YYYY-MM-DD", priority?, staffId?, note? }` while New/Assigned                                                                                                  |
| POST   | `/manage/reports/:id/review`                                                                                        | body `{ decision: "approve" \| "request_info", note? }` (note required for `request_info`)                                                                                                     |
| GET    | `/manage/reports/:id/history`                                                                                       | full audit trail (newest first) + resolution time                                                                                                                                              |
| GET    | `/manage/monitor`                                                                                                   | assigned / due today / overdue counters and team workload per department                                                                                                                       |

Creating staff: `POST /users` now accepts an optional `departmentId` (see `GET /departments`).

Notes

- "Today", "overdue" and "this month" use the database clock (Supabase = UTC).
- The default due date used when staff claim without choosing one is in `DEFAULT_DUE_DAYS` (`src/utils/workflow.js`).
- Not built (design extras): staff duty status, notifications, password reset by email, analytics.

## Feedback API (Stage 5) base `/api/feedback`

Any signed-in user can send feedback. It is stored **anonymously** (the `feedback` table has no user column), so it is only used to improve the campus.

| Method | Route       | Who        | Notes |
| ------ | ----------- | ---------- | ----- |
| POST   | `/feedback` | any signed-in user | body `{ category, message, rating?, suggestion? }`. `category` is `cleanliness`, `energy`, `water` or `general`; `message` 5-2000 chars; `rating` a whole number 1-5. Returns `201`. Limited to 10 per hour. |
| GET    | `/feedback?category=&page=&limit=` | management only | `{ summary: { total, averageRating }, feedback: [...], pagination }`, newest first |

Validation problems come back as `400` with `errors: { field: message }`, like the other endpoints.

## Tests

`npm test` runs the tests against a fake in-memory database (no Supabase or internet needed). They check every route is wired, the whole life of a report (assign, start, submit, request more info, approve), who is allowed to do what, the SQL placeholders, and the feedback endpoints (validation, anonymity, management-only listing, and the edit/delete race fix).

## Structure

```
server.js                       entry point
src/app.js                      express app, security middleware, routes
src/config/db.js                PostgreSQL connection
src/routes/                     URL definitions
src/controllers/                request logic (auth, user, report, staff, manage, feedback)
src/middleware/                 auth (authenticate / authorize), rate limit, errors
src/utils/                      token, validators, mailer, verification codes, storage, image check,
                                workflow (states + rules), reportTx (row lock + history), listing (filters, paging)
scripts/seed-admin.js           first management account
scripts/setup-storage.js        creates the Supabase photo bucket
database/                       schema.sql + stage migrations (run in order)
```

## Roadmap

1. Foundation (done)
2. Auth + roles (done)
3. Reports (reporter side) (done)
4. Staff + management (done)
5. Feedback (done) and analytics (to do)

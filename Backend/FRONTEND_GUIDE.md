# Eco Aware - Front-end integration guide

For the front-end team. Everything below is already working in the backend.

## 0. Setup

- **API base URL:** `http://localhost:5000/api` (keep it in one config value, e.g. `VITE_API_URL`).
- **CORS:** the backend `.env` value `CLIENT_URL` must be the _exact_ origin of your dev server
  (Vite = `http://localhost:5173`, Create React App = `http://localhost:3000`). Otherwise the browser blocks every request.
- **Token:** after login / verify, save `token`. Send `Authorization: Bearer <token>` on every protected call.
  On a `401`, delete the token and go to the login page. Logout = delete the token.
- **Errors** always look like `{ "success": false, "message": "...", "errors": { "fieldName": "..." } }`.
  Show `errors.<field>` under the matching input; show `message` as a toast/banner.

One helper handles JSON and file uploads:

```js
const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export async function api(path, { method = "GET", json, formData } = {}) {
  const headers = {};
  const token = localStorage.getItem("token");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  // For FormData do NOT set Content-Type: the browser adds it (with the boundary).
  const res = await fetch(API + path, {
    method,
    headers,
    body: json ? JSON.stringify(json) : formData,
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(data.message), data, { status: res.status });
  return data;
}
```

## 1. Changes needed on the Sign-up / Login screens

| Screen                             | What to change                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Reporter Sign Up**               | `POST /auth/signup` with `{ email, username, phone, password }`. On success (201) go to the Verify screen and keep `email` and `reference` from the response. On 400/409 show `errors.email`, `errors.username`, etc. Add hints: password 8+ characters with letters and numbers; username 3-30 letters, numbers, underscore.                                            |
| **Verify Your Account** (6 boxes)  | Show `reference` as "My Reference Code". Join the boxes into one string and `POST /auth/verify-email` with `{ email, code: "481123" }`. On success save `token` + `user` and go to the reporter home. **Resend** -> `POST /auth/resend-code` `{ email }` (429 = wait 60s; show the message). Codes expire in 10 minutes; 5 wrong tries lock the code (user must resend). |
| **Reporter Login**                 | `POST /auth/login` with `{ email, password, portal: "reporter" }`. If it fails with **403 and `requiresVerification: true`**, send the user to the Verify screen with `response.email` and call resend-code to give them a fresh code.                                                                                                                                   |
| **Staff Login**                    | `{ identifier, password, portal: "staff" }` (identifier = staff ID/username or email).                                                                                                                                                                                                                                                                                   |
| **Management Login**               | `{ email, password, portal: "management" }`.                                                                                                                                                                                                                                                                                                                             |
| **Staff + Management login pages** | **Remove the "Sign Up" links.** One design version has them, but these accounts are created by management (`POST /users`), never self-registered.                                                                                                                                                                                                                        |
| **Forgot Password**                | Not built yet. Hide the link or disable it for now.                                                                                                                                                                                                                                                                                                                      |
| **After login**                    | Route by `user.role`: `reporter`, `staff`, `management`.                                                                                                                                                                                                                                                                                                                 |

`portal` = which login page was used. If the account's role doesn't match, the API answers 403.

## 2. Report an Issue form

`POST /reports` as **FormData** (not JSON), reporter token required.

| Field                   | Notes                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `category`              | `Waste`, `Water`, `Energy`, `Safety` or `Other` (use these as the dropdown values)                        |
| `description`           | 10-2000 characters                                                                                        |
| `photos`                | Append each file under the same key `photos`. 1 to 5 files, JPG/PNG/WebP, max 5 MB each                   |
| `latitude`, `longitude` | Optional, but send both or neither                                                                        |
| `title`                 | Optional. If empty the backend makes one from the category + description                                  |
| `location`              | Optional text (max 200), e.g. "Science Building - Room 303" (the Location field of the newer form design) |

```js
const fd = new FormData();
fd.append("category", category);
fd.append("description", description);
files.forEach((f) => fd.append("photos", f));
if (coords) {
  fd.append("latitude", coords.latitude);
  fd.append("longitude", coords.longitude);
}
const { report } = await api("/reports", { method: "POST", formData: fd });
// then open the detail page with report.id
```

- Camera: `<input type="file" accept="image/*" capture="environment">`
- GPS: `navigator.geolocation.getCurrentPosition(...)` (works on `localhost` and HTTPS only). If the user denies it, submit without coordinates.

## 3. My Reports page

`GET /reports/mine?status=Pending|In Progress|Resolved&page=1&limit=20` (leave `status` out for "All Reports").

```json
{
  "reports": [
    {
      "id": "uuid",
      "reportCode": "EA-2026-0001",
      "title": "...",
      "category": "Waste",
      "description": "...",
      "status": "Pending",
      "thumbnail": "https://...",
      "createdAt": "...",
      "resolvedAt": null
    }
  ],
  "counts": { "all": 4, "Pending": 1, "In Progress": 2, "Resolved": 1 },
  "pagination": { "page": 1, "limit": 20, "total": 4, "totalPages": 1 }
}
```

- Tab badges come from `counts`.
- Show `Pending` as the label **"Pending Review"**. The status value itself is `Pending`.
- "Report ID: #EA-2026-0001" = `"#" + reportCode`. "View Details" opens `/reports/:id`.

## 4. Report detail page

`GET /reports/:id` (the `id` can be the UUID or the report code).

- `status` -> the badge and the colored banner.
- `photos.reported` -> "Reported Photos". For a Resolved report, "Before" = `photos.reported[0]`, "After" = `photos.after[0]` (staff upload it when they submit the fix).
- `steps` -> the "Resolution Progress" timeline, already in order. Each item is `{ step, state: "done" | "current" | "upcoming", at, note }`.
- `resolution` -> the Resolution Summary card (`resolvedBy`, `resolvedAt`, `actionTaken`). It is `null` until Resolved.
- `latitude` / `longitude` -> optional "view on map" link.
- **Edit / Delete** (only while `status` is `Pending`): `PATCH /reports/:id` with `{ title?, description?, category? }` and `DELETE /reports/:id`. Otherwise the API returns 409.
- `estimatedCompletion` ("YYYY-MM-DD" or `null`) -> the yellow "Your issue is being resolved. Estimated completion: ..." banner. It appears once the report has been assigned.
- `location` -> text such as "Science Building - Room 303" (may be `null`).

## 5. Staff portal (role `staff`)

All routes need the staff token. Use `GET /staff/...` for screens and `POST /staff/reports/:id/...` for actions. Every list returns `{ reports|tasks, pagination }`; every action returns `{ success, message, report }` (the full report, same shape as `GET /reports/:id`).

| Screen           | Call                                                                                                                                                                                                                                                                                                | Use                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard        | `GET /staff/dashboard`                                                                                                                                                                                                                                                                              | `stats.incoming.count` / `.critical`, `stats.inProgress.count` / `.teams`, `stats.resolvedToday`, `stats.assignedToYou.count` / `.dueToday`; `recentIncoming` = the table                                                   |
| Incoming reports | `GET /staff/reports/incoming?category=&priority=&search=&from=&to=&sort=`                                                                                                                                                                                                                           | Table columns: `reportCode`, `category`, `description`, `location`, `reportedBy.username` (+ `reportedBy.role`), `createdAt` (show "8 min ago"), `priority`. The sidebar badge = `stats.incoming.count` from the dashboard. |
| Review button    | `GET /reports/:id` then **Take it**: `POST /staff/reports/:id/claim` (`{ dueDate?, priority? }`)                                                                                                                                                                                                    | After claiming, the report moves to My assignments                                                                                                                                                                          |
| My assignments   | `GET /staff/assignments?tab=active\|overdue\|completed`                                                                                                                                                                                                                                             | `stats` = the 4 cards; `counts` = tab numbers; `tasks[].taskStatus` = "Not started" / "In progress" / "Overdue" / "Awaiting review"; `dueDate`, `priority`, `reportCode`                                                    |
| Update button    | **Start work**: `POST /staff/reports/:id/start` `{ note? }` (the note is shown to the reporter on their timeline, so keep it friendly; leave it empty for the default text). **Finish**: `POST /staff/reports/:id/resolution` as FormData with `note` and one or more `photos` (the "after" photos) | After finishing, `workflowState` is `pending_review`; the report waits for management                                                                                                                                       |
| Resolved         | `GET /staff/reports/resolved?days=30&mine=true`                                                                                                                                                                                                                                                     | `stats` cards; each row has `resolvedBy`, `resolutionNote`, `durationMinutes`, `resolvedAt`. (Satisfaction rating is not available yet.)                                                                                    |
| Team             | `GET /staff/team`                                                                                                                                                                                                                                                                                   | `summary` cards + `members[]` (`department.name`, `activeAssignments`, `resolvedThisMonth`). No duty-status field.                                                                                                          |

Report row fields for staff and management lists: `id`, `reportCode`, `title`, `category`, `description`, `location`, `priority` (`Low|Medium|High|Critical`), `dueDate`, `isOverdue`, `workflowState`, `stateLabel`, `department`, `assignedTo`, `reportedBy`, `thumbnail`, `createdAt`.

`workflowState` values: `new`, `assigned`, `in_progress`, `pending_review`, `resolved`. `stateLabel` is ready to show ("New", "Assigned", "In progress", "Pending review", "Resolved").

"Create staff report" button: same as the reporter form, `POST /reports` (FormData) with the staff token.

## 6. Management portal (role `management`)

| Screen                   | Call                                                                                                                                 | Use                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                | `GET /manage/dashboard`                                                                                                              | `stats` = the 4 tiles (`openReports` + `newThisWeek`, `assigned` + `dueToday`, `inProgress` + `medianResolutionDays`, `resolutionRate`); `byCategory[]` = the bars; `recent[]` = table                                                                                                                                                            |
| All reports              | `GET /manage/reports?status=&category=&search=&from=&to=&page=`                                                                      | Table + status filter (`new`, `assigned`, `in_progress`, `pending_review`, `resolved`, `all`). `counts` gives the number for each. "Create report" = `POST /reports`.                                                                                                                                                                             |
| Review and assign        | `GET /reports/:id`, departments from `GET /departments`, optional staff list from `GET /users?role=staff` (each has `department_id`) | Then `POST /manage/reports/:id/assign` with `{ departmentId, dueDate: "2026-09-22", priority: "High", staffId? }`. Only works while the report is `new` or `assigned`.                                                                                                                                                                            |
| Monitor assigned reports | `GET /manage/monitor` + `GET /manage/reports?...`                                                                                    | `summary` = Assigned / Due today / Overdue; `teamWorkload[]` = the "Team workload" box; **View queue** = `GET /manage/reports?departmentId=ID`. Use `&overdue=true` for overdue only.                                                                                                                                                             |
| Review resolution        | `GET /manage/reports?status=pending_review` for the queue, `GET /reports/:id` for the page                                           | Page fields: `photos.reported` (top images), `photos.after`, `technicianUpdate` (`note`, `submittedBy`, `submittedAt`, `team`), `evidenceComplete` (the "Evidence complete" chip), `reviewNote`. Buttons: `POST /manage/reports/:id/review` with `{ decision: "approve", note? }` or `{ decision: "request_info", note: "..." }` (note required). |
| Status history           | `GET /manage/reports/:id/history`                                                                                                    | `events[]` newest first: `{ step, note, at, by: { username, role } }`; `resolutionTime` = `{ days, hours, totalHours }` (or `null` until resolved); `report.stateLabel` = "Current status"                                                                                                                                                        |

Steps you may see in `events` / `timeline`: Report Submitted, Under Review, Team Assigned, Work In Progress, Resolution Submitted, More Info Requested, Reassigned, Claimed, Resolved. Reporters only ever see their own 5 (Report Submitted, Under Review, Team Assigned, Work In Progress, Resolved).

Create staff accounts (management only): `POST /users` `{ email, username, password, role: "staff", departmentId }`.

## 7. Status codes

`400` validation (see `errors`) · `401` not logged in / bad token · `403` wrong role or unverified · `404` not found (also used when a report belongs to someone else) · `409` conflict (duplicate email, report no longer Pending, action not allowed in the report's current state, report already taken) · `429` too many attempts.

## 8. Feedback (all roles)

`POST /api/feedback` with a bearer token, JSON body:

```json
{ "category": "water", "message": "The new fountains are great", "rating": 4, "suggestion": "Add more" }
```

- `category`: `cleanliness` | `energy` | `water` | `general` (required)
- `message`: 5-2000 characters (required)
- `rating`: whole number 1-5 (optional), `suggestion`: up to 2000 characters (optional)
- Success: `201 { "success": true, "message": "Thank you for your feedback" }`
- Problems: `400 { "message": "...", "errors": { "message": "..." } }`. Show each error next to its field.
- Feedback is anonymous: the user's id is never stored.

Management can read it with `GET /api/feedback` (see the README). There is no screen for that in the management portal yet.

## 9. Report form location

`POST /api/reports` also accepts `latitude` and `longitude` (send both or neither) and `location` (free text, up to 200 characters, for example "Science Building - Room 303"). `report.html` sends them.

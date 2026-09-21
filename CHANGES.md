# What was fixed

## Made real (were pretending to work)
- **Feedback form** now really saves feedback: new `POST /api/feedback` (anonymous, validated, rate-limited) and `GET /api/feedback` (management). Empty or invalid submissions show messages, and a server failure is shown instead of a fake "Submitted".
- **Report form** now captures GPS (with the browser's permission) and sends `latitude` / `longitude`, plus an optional "Where is it?" field. The old text promised GPS but never sent it. Errors appear next to the field instead of `alert()` pop-ups.
- **Contact Us** and **About Us** no longer show developer placeholder text. Contact has action tiles and a `CONTACT` config block (fill in your real details); About explains how the app works.

## Layout and navigation
- Header on phones: the links no longer overflow and the hamburger menu works. The hamburger no longer shows on desktop. (An inline `display:flex` was overriding the mobile rule.)
- Reporters no longer get dead-end links to the staff and management portals. Header and bottom bar depend on the role.
- Phone overflow fixed on the management dashboard, monitoring page, staff team page and the sign-up header.
- Footer year is now dynamic (was "2024" on 9 pages).
- Home card renamed "Your Eco-Impact" (it shows the user's own numbers).
- Report detail pages redirect to the page matching the report's real status; removed a promise of email / app notifications that do not exist; photo URLs are escaped.
- Form labels are linked to their inputs.

## Login
- Removed the demo-credentials pop-up (those accounts did not exist) and the hard-coded demo passwords from every page.
- "Forgot password" message no longer says the server is not connected.
- `contact.html` now uses the real shared auth code instead of the old fake localStorage login.

## Backend
- Deleting or editing a report now checks that the update really happened (returns 409 if the team picked it up a moment earlier) instead of reporting success.
- Removed an unused import; added `feedbackLimiter`.
- New tests in `tests/feedback.test.js`, included in `npm test`.

## Housekeeping
- Old prototype files and an unused `test.jpg` moved to `_archive/`.
- READMEs and `FRONTEND_GUIDE.md` updated; top-level README added.
- `.env` and `node_modules` are NOT included in this zip.

## Still open (not done on purpose)
- Real contact details: fill in `CONTACT` in `contact.html`.
- Password reset by email, a management screen to read feedback, and a campus-wide impact endpoint are not built.
- Rotate the Supabase service-role key, DB password and JWT secret if the old backup zip was shared anywhere.

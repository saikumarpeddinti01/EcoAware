# Eco Aware

A campus environmental issue reporting platform. Reporters send photos of problems, management assigns them to teams, staff fix them, and management checks the fix.

```
Backend/    Node.js + Express + Supabase (PostgreSQL) API        -> see Backend/README.md
Frontend/   plain HTML / CSS / JavaScript, no build step          -> see Frontend/README.md
_archive/   old prototype files nothing uses any more (safe to delete)
```

## Run it locally

1. Backend: `cd Backend`, `npm install`, copy `.env.example` to `.env` and fill it in, run the SQL files in `database/` in order, then `npm run setup:storage`, `npm run seed:admin`, `npm run dev`.
2. Frontend: from the `Frontend` folder run `python -m http.server 5173` and open `http://localhost:5173/role.html`.
3. Tests: `cd Backend && npm test`.

## Keep your secrets safe

`Backend/.env` holds your database URL, the Supabase service-role key and the JWT secret. It is git-ignored: never commit it or put it in a zip you share. If it has been shared, rotate those values.

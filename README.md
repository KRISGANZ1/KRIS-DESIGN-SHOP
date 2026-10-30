# KRIS DESIGN SHOP

## Local development

1. Copy `.env.example` to `.env` and set a private admin password and session secret.
2. Run `npm install`.
3. Run `npm start` and open `http://localhost:3000`.

Without `DATABASE_URL`, the app uses the local SQLite database. Local uploads are written to `public/uploads/`.

## Vercel deployment

Create a managed PostgreSQL database and a Vercel Blob store, then configure these Vercel project environment variables for Production (and Preview if required):

- `DATABASE_URL` — PostgreSQL connection string from the database provider.
- `SESSION_SECRET` — long, random, private value.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` — initial admin credentials; use a strong password.
- `BLOB_READ_WRITE_TOKEN` — token for the Vercel Blob store.
- `DATABASE_SSL` — normally leave unset for managed PostgreSQL; set to `disable` only for a trusted local PostgreSQL connection.

The app creates its PostgreSQL tables and seeds default catalog/payment data on its first request. The admin user is initialized from the environment variables above. `/api/*` requests run through the Express function in `api/[...path].js`; customer routes are rewritten to the SPA entry point.

Product and QRIS images accept PNG, JPG, and WEBP files up to 15 MB. On Vercel, the browser uploads images directly to Blob using a short-lived, admin-authorized upload token; files do not pass through the serverless function request-size limit.

**Existing SQLite data is not automatically migrated.** Before switching a live store to Vercel, export and import the SQLite products, categories, payment methods, orders, and admin account into the configured PostgreSQL database. Local uploaded images also need to be uploaded again; new uploads on Vercel use Blob and persist across deployments.

### Migrate the current local store

Back up `data/krisdesign.db` first. Set `DATABASE_URL` to the destination PostgreSQL database and set `BLOB_READ_WRITE_TOKEN` if local products/payment methods reference files in `public/uploads/`. Then run:

```powershell
npm run migrate:postgres
```

Set `SOURCE_SQLITE_PATH` if the SQLite database is not at `data/krisdesign.db`. The migration creates the schema and upserts admin users, categories, products, payment methods, and orders by ID; it does not delete source data or target-only rows. Existing `/uploads/...` files are transferred to Vercel Blob and their database URLs are updated as part of the migration.

Never commit `.env` or deployment secrets. Vercel-hosted SQLite and local filesystem uploads are not persistent, so production deployments require `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`.

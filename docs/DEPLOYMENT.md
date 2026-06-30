# Deployment guide

Store OS is a static SPA (Vite build) + Firebase (Auth + Firestore). Deploy the
frontend to **Vercel** and point it at a real Firebase project. This guide covers
both.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Sign-in method:** enable **Email/Password** and
   **Google**.
3. **Build → Firestore Database → Create database** (production mode). Pick a
   region close to your users.
4. **Build → Storage → Get started** (creates the default bucket). Browser photo
   uploads need CORS configured on the bucket — see step 4.
5. **Project settings → Your apps → Web (`</>`)** → register a web app → copy the
   `firebaseConfig` values (apiKey, authDomain, projectId, …).

## 2. Set environment variables on Vercel

The public Firebase config is safe to ship in the client bundle — access is
enforced by **Security Rules**, not by hiding these keys. In your Vercel project
(Settings → Environment Variables), add:

| Variable | Value |
|----------|-------|
| `VITE_FIREBASE_API_KEY` | from firebaseConfig |
| `VITE_FIREBASE_AUTH_DOMAIN` | `_<projectId>_.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | your project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | `_<projectId>_.appspot.com` |
| `VITE_FIREBASE_SENDER_ID` | messaging sender id |
| `VITE_FIREBASE_APP_ID` | app id |

**Do NOT set** `VITE_FIREBASE_EMULATOR` in production — that flag routes Auth +
Firestore to localhost (it's for local tests only).

## 3. Deploy the security rules

The repo ships `firestore.rules` (data) and `storage.rules` (product photos).
Deploy them once (and on rule changes):

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage:rules
```

(Or `npm run deploy:rules`, which runs the same.) The Storage rules allow public
read (the anonymous catalog loads photos) and require store membership to
write/delete, verified via a cross-service Firestore lookup.

## 4. Configure Storage CORS (required for browser uploads)

Browser uploads to Firebase Storage trigger a CORS preflight. Buckets ship with
**no CORS config by default**, so uploads from your Vercel domain fail with a
preflight/CORS error until you set it. The repo's `cors.json` allows all origins
(`*`) — safe, because Storage rules still enforce auth on writes; CORS only gates
which browser origins may attempt the request.

Apply it with `gsutil` (Google Cloud SDK; `gcloud auth login` first):

```bash
gsutil cors set cors.json gs://<projectId>.firebasestorage.app
gsutil cors get gs://<projectId>.firebasestorage.app   # verify
```

Use the bucket name from `VITE_FIREBASE_STORAGE_BUCKET`.

## 5. Deploy to Vercel

```bash
npm install
npm run build          # verify locally first
```

Then either:
- **Vercel dashboard:** import the GitHub repo; framework auto-detected (Vite);
  add the env vars from step 2; deploy.
- **CLI:** `npm i -g vercel && vercel` (link the project, add env vars, deploy).

`vercel.json` already sets the SPA rewrite (so deep links like `/catalogo/:slug`
work on refresh) and long-cache headers for `/assets/*`.

## 6. First user = super-admin

The very first account created on the deployed app becomes the **super_admin**
(you). Sign up, then invite store owners by email from each store's settings.

## Local development / testing

- **Demo mode (no backend):** `npm run dev` — runs fully on `localStorage` with
  seeded demo data.
- **With emulator:** `npm run emulators` (Auth + Firestore on localhost), then
  `npm run dev` with `VITE_FIREBASE_EMULATOR=true` in `.env`, or
  `npm run e2e:firebase` for the emulator test suite.

## Notes

- **Public catalog for cloud stores:** Firestore rules hide products from
  non-members, so `/catalogo/:slug` works for local demo stores but cloud stores
  need a public-read path (deferred). Tell users to share the catalog only for
  local/demo stores for now.
- **Member invites:** invitees who don't have an account yet receive a Firebase
  email sign-in link; once they sign up they're added to the store.

# Migrated staff identifiers

The staff compatibility mapper spread `legacy_data.id` into the object returned to
the UI. Callers combined `{ id: snapshot.id, ...snapshot.data() }`, allowing the
imported Firestore id to overwrite the native UUID. The account Edge Function then
rejected delete/unlink with `invalid_staff_id`.

The mapper now explicitly returns the native row id after spreading imported data.
The Edge Function also accepts legacy document ids from older open tabs, resolves
an exact `staff_profiles.firestore_id` match once, and uses that UUID for both
inspection and mutation. Authorization and rate limiting precede the lookup.
Existing database protections still apply; administrator account ids remain UUIDs.
No migration or permissions change was needed.

Deployment: Supabase `staff-account-admin` version 17, ACTIVE, JWT verification on.
Firebase release was built from `tmp/session-access-release` into
`tmp/legacy-staff-id-release`, preserving previous login/admin fixes without
including unrelated local features. Live asset: `index-BWcnu6Yd.js`.
SHA256: `91DC9C022B67257028C48DA3DC2780D7B6E37D921D1D09BB4EEEAC0A19D5B450`.

Validation:
- Edge tests cover legacy delete/unlink resolution, native UUIDs, missing targets,
  lookup failures, rejected roles, rate limits, and protected accounts.
- Actual compatibility snapshots are tested with conflicting imported ids in both
  the working source and isolated release.
- Authenticated invocation and dashboard account-action regressions pass.
- Production verification uses disposable accounts/staff only. New `firestore_id`
  values are blocked by the existing database trigger, so the UI fixture reproduces
  the collision through `legacy_data.id`. This restriction was preserved. The
  successful legacy lookup branch is tested locally; production tests exercise
  missing-legacy lookup and native unlink/delete.
- Live browser verification passed: cancel retains the fixture; confirming sends
  its native UUID, receives HTTP 200, removes the row, and updates the directory.
  All temporary fixtures were removed successfully.
- Published asset contents match the local build hash.

Reproduce verification with `scripts/verify-legacy-staff-id-deployment.mjs` and the
same explicit environment opt-in as `verify-superadmin-deployment.mjs`. Fixtures
are cleaned in `finally`. The reported real collaborator was not deleted by QA.

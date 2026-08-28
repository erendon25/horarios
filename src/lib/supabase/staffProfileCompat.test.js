import test from "node:test";
import assert from "node:assert/strict";
import { withCanonicalStaffIdentity } from "./staffProfileCompat.js";

test("el perfil expone únicamente el UUID canónico de Supabase", () => {
  const mapped = withCanonicalStaffIdentity(
    {
      id: "ee2083a3-5255-51ca-a5bf-3302f6ac0043",
    },
    {
      id: "qvSzMAUZLhzUj3UM8Un5",
      name: "Perfil migrado",
    },
  );

  assert.equal(mapped.id, "ee2083a3-5255-51ca-a5bf-3302f6ac0043");
  assert.equal(Object.hasOwn(mapped, "firestoreId"), false);
});

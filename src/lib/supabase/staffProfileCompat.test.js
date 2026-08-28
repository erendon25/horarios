import test from "node:test";
import assert from "node:assert/strict";
import { withCanonicalStaffIdentity } from "./staffProfileCompat.js";

test("el UUID canónico prevalece sobre el id heredado de Firebase", () => {
  const mapped = withCanonicalStaffIdentity(
    {
      id: "ee2083a3-5255-51ca-a5bf-3302f6ac0043",
      firestore_id: "qvSzMAUZLhzUj3UM8Un5",
    },
    {
      id: "qvSzMAUZLhzUj3UM8Un5",
      name: "Perfil migrado",
    },
  );

  assert.equal(mapped.id, "ee2083a3-5255-51ca-a5bf-3302f6ac0043");
  assert.equal(mapped.firestoreId, "qvSzMAUZLhzUj3UM8Un5");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingEvidencePaths,
  isVerifiedTrainingCompletion,
  uploadTrainingEvidencePair,
  verifiedTrainingCompletionFromSnapshot,
  verifiedTrainingSkills,
} from "./trainingEvidenceCompat.js";

const storeId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";

test("construye el par de evidencia con tienda, evaluación y el mismo UUID", () => {
  assert.deepEqual(buildTrainingEvidencePaths(storeId, 37, evidenceId), {
    collabSignature: `${storeId}/37/${evidenceId}-collaborator.png`,
    trainerSignature: `${storeId}/37/${evidenceId}-trainer.png`,
  });
});

test("sube ambas firmas sin upsert", async () => {
  const calls = [];
  const bucket = {
    upload: async (path, blob, options) => {
      calls.push({ path, blob, options });
      return { data: { path }, error: null };
    },
    remove: async () => assert.fail("no debe limpiar una carga exitosa"),
  };
  const paths = buildTrainingEvidencePaths(storeId, 37, evidenceId);
  await uploadTrainingEvidencePair({
    bucket,
    paths,
    signatures: { collabSignature: "collab", trainerSignature: "trainer" },
    fetcher: async (value) => ({ blob: async () => ({ value }) }),
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.options), [
    { contentType: "image/png", upsert: false },
    { contentType: "image/png", upsert: false },
  ]);
});

test("espera las dos tareas y limpia la firma subida si la otra conversión falla", async () => {
  const removed = [];
  const paths = buildTrainingEvidencePaths(storeId, 37, evidenceId);
  const bucket = {
    upload: async (path) => ({ data: { path }, error: null }),
    remove: async (values) => { removed.push(...values); return { data: values, error: null }; },
  };
  await assert.rejects(() => uploadTrainingEvidencePair({
    bucket,
    paths,
    signatures: { collabSignature: "collab", trainerSignature: "trainer" },
    fetcher: async (value) => {
      if (value === "trainer") throw new Error("firma inválida");
      return { blob: async () => ({ value }) };
    },
  }), /firma inválida/);
  assert.deepEqual(removed, [paths.collabSignature]);
});

test("excluye completions legacy de las certificaciones derivadas", () => {
  const verified = { status: "completed", completionVerifiedAt: "2026-08-27T03:00:00Z", completionVersion: 1 };
  const legacy = { status: "completed", completionVerifiedAt: null, completionVersion: null };
  const evaluations = [
    { ...verified, collaboratorId: "one", area: "service", station: "servicio", score: 100 },
    { ...verified, collaboratorId: "one", area: "service", station: "despacho", score: 89 },
    { ...legacy, collaboratorId: "one", area: "service", station: "delivery", score: 100 },
    { ...verified, collaboratorId: "two", area: "service", station: "trafico", score: 100 },
  ];
  assert.equal(isVerifiedTrainingCompletion(evaluations[0]), true);
  assert.equal(isVerifiedTrainingCompletion(evaluations[2]), false);
  assert.deepEqual(verifiedTrainingSkills(evaluations, "one", "service"), ["SERVICIO"]);
});

test("materializa el resultado desde la fila posterior al trigger", () => {
  const persisted = {
    status: "completed",
    area: "service",
    completionVerifiedAt: "2026-08-27T03:00:00Z",
    completionVersion: 1,
  };
  const snapshot = {
    id: "37",
    exists: () => true,
    data: () => persisted,
  };

  assert.deepEqual(verifiedTrainingCompletionFromSnapshot(snapshot), {
    ...persisted,
    id: "37",
  });
});

test("no abre el resultado si la reconsulta no trae el sello del trigger", () => {
  const snapshot = {
    id: "37",
    exists: () => true,
    data: () => ({ status: "completed" }),
  };

  assert.throws(
    () => verifiedTrainingCompletionFromSnapshot(snapshot),
    /no confirmó la completion verificada/i,
  );
});

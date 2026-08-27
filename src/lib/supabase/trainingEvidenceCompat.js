const SIGNATURE_FIELDS = [
  ["collabSignature", "collaborator"],
  ["trainerSignature", "trainer"],
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildTrainingEvidencePaths(storeId, evaluationId, evidenceId = crypto.randomUUID()) {
  if (!UUID_RE.test(String(storeId ?? ""))) throw new Error("La tienda de la evaluación no es válida.");
  if (!/^\d+$/.test(String(evaluationId ?? ""))) throw new Error("El identificador de la evaluación no es válido.");
  if (!UUID_RE.test(String(evidenceId ?? ""))) throw new Error("El identificador de evidencia no es válido.");
  return Object.fromEntries(SIGNATURE_FIELDS.map(([field, role]) => [
    field,
    `${storeId}/${evaluationId}/${evidenceId}-${role}.png`,
  ]));
}

export async function uploadTrainingEvidencePair({ bucket, signatures, paths, fetcher = fetch }) {
  const uploads = await Promise.all(SIGNATURE_FIELDS.map(async ([field]) => {
    try {
      const response = await fetcher(signatures[field]);
      const blob = await response.blob();
      const result = await bucket.upload(paths[field], blob, {
        contentType: "image/png",
        upsert: false,
      });
      return { field, ...result };
    } catch (error) {
      return { field, data: null, error };
    }
  }));

  const failed = uploads.find((result) => result.error);
  if (!failed) return paths;
  const uploadedPaths = uploads
    .filter((result) => !result.error)
    .map((result) => paths[result.field]);
  if (uploadedPaths.length > 0) await bucket.remove(uploadedPaths);
  throw failed.error;
}

export function isVerifiedTrainingCompletion(evaluation) {
  const verifiedAt = evaluation?.completionVerifiedAt ?? evaluation?.completion_verified_at;
  const version = evaluation?.completionVersion ?? evaluation?.completion_version;
  return evaluation?.status === "completed"
    && Boolean(verifiedAt)
    && Number.isInteger(Number(version))
    && Number(version) > 0;
}

export function verifiedTrainingCompletionFromSnapshot(snapshot) {
  if (!snapshot?.exists?.()) {
    throw new Error("No se encontró la evaluación recién guardada.");
  }
  const persisted = snapshot.data();
  const evaluation = persisted && typeof persisted === "object"
    ? { ...persisted, id: String(snapshot.id) }
    : null;
  if (!isVerifiedTrainingCompletion(evaluation)) {
    throw new Error("Supabase no confirmó la completion verificada de la evaluación.");
  }
  return evaluation;
}

export function verifiedTrainingSkills(evaluations, staffId, area) {
  const source = Array.isArray(evaluations) ? evaluations : [];
  return [...new Set(source
    .filter((evaluation) => isVerifiedTrainingCompletion(evaluation)
      && Number(evaluation.score) >= 90
      && (evaluation.collaboratorId ?? evaluation.staff_id) === staffId
      && (!area || evaluation.area === area)
      && Boolean(evaluation.station ?? evaluation.station_code))
    .map((evaluation) => String(evaluation.station ?? evaluation.station_code).toUpperCase()))];
}

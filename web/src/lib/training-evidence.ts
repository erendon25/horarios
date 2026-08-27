export type TrainingEvidencePaths = {
  collaborator: string;
  trainer: string;
};

type TrainingCompletion = {
  status?: string | null;
  completion_verified_at?: string | null;
  completion_version?: number | null;
  score?: number | null;
  staff_id?: string | null;
  station_code?: string | null;
  area?: string | null;
};

type OperationResult = { error?: unknown };
type UploadOptions = { contentType: "image/png"; upsert: false };

export function buildTrainingEvidencePaths(storeId: string, evaluationId: number, evidenceId = crypto.randomUUID()): TrainingEvidencePaths {
  return {
    collaborator: `${storeId}/${evaluationId}/${evidenceId}-collaborator.png`,
    trainer: `${storeId}/${evaluationId}/${evidenceId}-trainer.png`,
  };
}

export function isVerifiedTrainingCompletion(evaluation: TrainingCompletion) {
  return evaluation.status === "completed"
    && Boolean(evaluation.completion_verified_at)
    && Number.isInteger(Number(evaluation.completion_version))
    && Number(evaluation.completion_version) > 0;
}

export function verifiedTrainingSkills(evaluations: TrainingCompletion[], staffId: string, area?: string) {
  return [...new Set(evaluations
    .filter((evaluation) => isVerifiedTrainingCompletion(evaluation)
      && Number(evaluation.score) >= 90
      && evaluation.staff_id === staffId
      && (!area || evaluation.area === area)
      && Boolean(evaluation.station_code))
    .map((evaluation) => String(evaluation.station_code).toLocaleUpperCase("es")))];
}

async function cleanupEvidence(paths: TrainingEvidencePaths, remove: (paths: string[]) => Promise<unknown>) {
  try {
    await remove([paths.collaborator, paths.trainer]);
  } catch {
    // A successful-but-ambiguous completion is expected to make this removal
    // fail under Storage RLS because the evidence is already referenced.
  }
}

export async function persistTrainingEvidencePair({
  paths,
  signatures,
  upload,
  complete,
  remove,
}: {
  paths: TrainingEvidencePaths;
  signatures: { collaborator: Blob; trainer: Blob };
  upload: (path: string, signature: Blob, options: UploadOptions) => Promise<OperationResult | void>;
  complete: (paths: TrainingEvidencePaths) => Promise<OperationResult | void>;
  remove: (paths: string[]) => Promise<unknown>;
}) {
  const uploads = await Promise.all(([
    [paths.collaborator, signatures.collaborator],
    [paths.trainer, signatures.trainer],
  ] as const).map(async ([path, signature]) => {
    try {
      const result = await upload(path, signature, { contentType: "image/png", upsert: false });
      return result?.error ?? null;
    } catch (error) {
      return error;
    }
  }));
  const uploadError = uploads.find((error) => error !== null);
  if (uploadError !== undefined) {
    await cleanupEvidence(paths, remove);
    throw uploadError;
  }

  try {
    const result = await complete(paths);
    if (result?.error) throw result.error;
  } catch (error) {
    await cleanupEvidence(paths, remove);
    throw error;
  }
}

export async function resolveTrainingSignatureUrl(
  path: string | null,
  createSignedUrl: (path: string) => Promise<string>,
) {
  if (!path) return null;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(path)) return path;
  return createSignedUrl(path);
}

import { describe, expect, it, vi } from "vitest";
import { buildTrainingEvidencePaths, isVerifiedTrainingCompletion, persistTrainingEvidencePair, resolveTrainingSignatureUrl, verifiedTrainingSkills } from "./training-evidence";

const signatures = { collaborator: new Blob(["collaborator"]), trainer: new Blob(["trainer"]) };
const paths = buildTrainingEvidencePaths("store-1", 42, "evidence-uuid");

describe("training evidence", () => {
  it("construye el par con la misma identidad de evidencia", () => {
    expect(paths).toEqual({
      collaborator: "store-1/42/evidence-uuid-collaborator.png",
      trainer: "store-1/42/evidence-uuid-trainer.png",
    });
  });

  it("espera ambos uploads y limpia el par si uno falla", async () => {
    const completedUploads: string[] = [];
    const remove = vi.fn(async () => undefined);
    const complete = vi.fn(async () => ({ error: null }));
    const upload = vi.fn(async (path: string, _blob: Blob, options: { contentType: string; upsert: boolean }) => {
      expect(options).toEqual({ contentType: "image/png", upsert: false });
      if (path.endsWith("trainer.png")) throw new Error("trainer upload failed");
      await Promise.resolve();
      completedUploads.push(path);
      return { error: null };
    });

    await expect(persistTrainingEvidencePair({ paths, signatures, upload, complete, remove })).rejects.toThrow("trainer upload failed");
    expect(completedUploads).toEqual([paths.collaborator]);
    expect(remove).toHaveBeenCalledWith([paths.collaborator, paths.trainer]);
    expect(complete).not.toHaveBeenCalled();
  });

  it("limpia los uploads si la finalización falla o queda ambigua", async () => {
    const remove = vi.fn(async () => ({ error: new Error("referenced evidence") }));
    await expect(persistTrainingEvidencePair({
      paths,
      signatures,
      upload: async () => ({ error: null }),
      complete: async () => { throw new Error("network ambiguity"); },
      remove,
    })).rejects.toThrow("network ambiguity");
    expect(remove).toHaveBeenCalledWith([paths.collaborator, paths.trainer]);
  });

  it("devuelve firmas data URL legacy sin pedir una URL firmada", async () => {
    const signer = vi.fn(async () => "signed");
    const legacy = "data:image/png;base64,AAAA";
    await expect(resolveTrainingSignatureUrl(legacy, signer)).resolves.toBe(legacy);
    expect(signer).not.toHaveBeenCalled();
    await expect(resolveTrainingSignatureUrl("store/42/file.png", signer)).resolves.toBe("signed");
    expect(signer).toHaveBeenCalledWith("store/42/file.png");
  });

  it("sólo deriva certificaciones desde completions verificadas", () => {
    const verified = { status: "completed", completion_verified_at: "2026-08-27T03:00:00Z", completion_version: 1 };
    const legacy = { status: "completed", completion_verified_at: null, completion_version: null };
    const evaluations = [
      { ...verified, staff_id: "one", area: "service", station_code: "servicio", score: 100 },
      { ...verified, staff_id: "one", area: "service", station_code: "despacho", score: 89 },
      { ...legacy, staff_id: "one", area: "service", station_code: "delivery", score: 100 },
      { ...verified, staff_id: "two", area: "service", station_code: "trafico", score: 100 },
    ];
    expect(isVerifiedTrainingCompletion(evaluations[0])).toBe(true);
    expect(isVerifiedTrainingCompletion(evaluations[2])).toBe(false);
    expect(verifiedTrainingSkills(evaluations, "one", "service")).toEqual(["SERVICIO"]);
  });
});

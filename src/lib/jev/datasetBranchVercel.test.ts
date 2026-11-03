import { describe, expect, it } from "vitest";
import {
  JEV_DATASET_VERCEL_JSON,
  jevDatasetVercelJsonText,
} from "./datasetBranchVercel";

describe("jevDatasetVercelJsonText", () => {
  it("disables all Vercel deployments on the dataset branch", () => {
    expect(JEV_DATASET_VERCEL_JSON.git.deploymentEnabled).toBe(false);
    const parsed = JSON.parse(jevDatasetVercelJsonText()) as {
      git: { deploymentEnabled: boolean };
    };
    expect(parsed.git.deploymentEnabled).toBe(false);
  });
});

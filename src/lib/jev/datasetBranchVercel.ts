/**
 * Vercel config committed on the orphan `jev-risk-data` branch.
 * Vercel reads vercel.json from the branch being built, not from `image`.
 */
export const JEV_DATASET_VERCEL_JSON = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  git: {
    deploymentEnabled: false,
  },
} as const;

/** Serialized vercel.json for the dataset branch (stable formatting for git diffs). */
export function jevDatasetVercelJsonText(): string {
  return `${JSON.stringify(JEV_DATASET_VERCEL_JSON, null, 2)}\n`;
}

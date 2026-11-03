import { drillSchema, type Drill } from "../../schemas/speelboek";
import { manMeer42 } from "./manMeer42";
import { tipIn } from "./tipIn";
import { zone56 } from "./zone56";

/**
 * All drills in the speelboek, validated against {@link drillSchema} at module
 * load so authoring mistakes fail the build and tests instead of the page.
 */
export const DRILLS: readonly Drill[] = [tipIn, manMeer42, zone56].map((d) =>
  drillSchema.parse(d),
);

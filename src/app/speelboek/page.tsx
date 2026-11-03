import type { Metadata } from "next";
import * as Sentry from "@sentry/nextjs";
import SpeelboekLibrary from "../../components/speelboek/SpeelboekLibrary";
import { getAllDrills } from "../../lib/services/speelboekService";
import { getUpcomingProgram } from "../../lib/services/trainingProgramService";

export const metadata: Metadata = {
  title: "Speelboek – H3 Teamy",
  description: "Tactiek en techniek van H3: oefeningen stap voor stap.",
};

export const dynamic = "force-dynamic";

/** Speelboek library page: static + published trainer drills and the next training programme. */
export default async function SpeelboekPage() {
  const [drills, program] = await Promise.all([
    getAllDrills(false),
    getUpcomingProgram().catch((err: unknown) => {
      Sentry.captureException(err, { tags: { component: "speelboek" } });
      return null;
    }),
  ]);
  return (
    <SpeelboekLibrary
      nowIso={new Date().toISOString()}
      initialDrills={drills}
      program={program}
    />
  );
}

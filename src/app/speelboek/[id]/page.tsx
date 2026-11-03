import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DrillDetail from "../../../components/speelboek/DrillDetail";
import {
  findDrill,
  getCounterpart,
} from "../../../lib/services/speelboekService";

/** Trainer drills live in Postgres and change at any time. */
export const dynamic = "force-dynamic";

type Params = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const drill = await findDrill(id);
  return drill
    ? { title: `${drill.title} – Speelboek`, description: drill.summary }
    : { title: "Speelboek" };
}

/** Drill detail page; unknown slugs render the 404 page. */
export default async function DrillPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const drill = await findDrill(id);
  if (!drill) notFound();
  return (
    <DrillDetail
      key={drill.id}
      drill={drill}
      counterpart={await getCounterpart(drill)}
    />
  );
}

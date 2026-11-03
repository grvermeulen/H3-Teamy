import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DrillDetail from "../../../components/speelboek/DrillDetail";
import {
  getCounterpart,
  getDrill,
} from "../../../lib/services/speelboekService";
import { DRILLS } from "../../../lib/speelboek/drills";

type Params = { id: string };

/** Pre-render every drill; the content is static. */
export function generateStaticParams(): Params[] {
  return DRILLS.map((d) => ({ id: d.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const drill = getDrill(id);
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
  const drill = getDrill(id);
  if (!drill) notFound();
  return (
    <DrillDetail
      key={drill.id}
      drill={drill}
      counterpart={getCounterpart(drill)}
    />
  );
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { notFound, redirect } from "next/navigation";
import EditDrillGate from "../../../../components/speelboek/EditDrillGate";
import { drillToInput } from "../../../../lib/speelboek/editor";
import {
  findDrill,
  getAllDrills,
} from "../../../../lib/services/speelboekService";
import { isTrainer } from "../../../../lib/trainer";

export const dynamic = "force-dynamic";

type Params = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const drill = await findDrill(id);
  return { title: drill ? `${drill.title} bewerken – Speelboek` : "Speelboek" };
}

/**
 * Edit a trainer drill. Static library drills cannot be edited in place; they
 * open as a copy in the new-drill flow instead.
 */
export default async function EditDrillPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const drill = await findDrill(id);
  if (!drill) notFound();
  if (drill.source === "static") redirect(`/speelboek/nieuw?van=${id}`);
  const req = new NextRequest("http://localhost", { headers: await headers() });
  const { isTrainer: trainer } = await isTrainer(req);
  const others = trainer
    ? (await getAllDrills(true))
        .filter((d) => d.id !== id)
        .map((d) => ({ id: d.id, title: d.title }))
    : [];
  return (
    <EditDrillGate
      drillId={id}
      initial={drillToInput(drill, drill.published)}
      counterparts={others}
    />
  );
}

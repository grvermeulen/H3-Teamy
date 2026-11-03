import type { Metadata } from "next";
import NewDrillFlow from "../../../components/speelboek/NewDrillFlow";

export const metadata: Metadata = {
  title: "Nieuwe oefening – Speelboek",
};

export const dynamic = "force-dynamic";

/** Trainer entry point for a new drill; `?van=<slug>` starts from a copy of that drill. */
export default async function NewDrillPage({
  searchParams,
}: {
  searchParams: Promise<{ van?: string }>;
}) {
  const { van } = await searchParams;
  return <NewDrillFlow copyFromId={van} />;
}

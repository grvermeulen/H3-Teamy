import type { Metadata } from "next";
import SpeelboekLibrary from "../../components/speelboek/SpeelboekLibrary";

export const metadata: Metadata = {
  title: "Speelboek – H3 Teamy",
  description: "Tactiek en techniek van H3: oefeningen stap voor stap.",
};

export const dynamic = "force-dynamic";

/** Speelboek library page; drill content is static, "now" decides the "Nieuw" badge. */
export default function SpeelboekPage() {
  return <SpeelboekLibrary nowIso={new Date().toISOString()} />;
}

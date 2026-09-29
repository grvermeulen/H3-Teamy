import type { Metadata } from "next";
import StaalFight from "@/components/staalFight/StaalFight";

export const metadata: Metadata = {
  title: "Staal vs. Trump · GTA H3",
  description:
    "Een arcadegevecht in Street Fighter-stijl: Staal tegen Trump, met combo's, een slow-motion finisher en een welverdiend biertje.",
};

/** The Staal vs. Trump fight animation, full screen. */
export default function StaalFightPage(): React.JSX.Element {
  return <StaalFight />;
}

import type { z } from "zod";
import type { drillSchema } from "../../schemas/speelboek";
import { KEEPER_ID, STANDARD_POSITIONS, standardLineup } from "../lineup";

const base = standardLineup();
const withBallAt5 = { ...base, ballPlayerId: "p5" };

/** Henry's ideeënbus idea: an action in front of the goal followed by a tip-in. */
export const tipIn: z.input<typeof drillSchema> = {
  id: "tip-in",
  title: "Tip-in",
  summary: "Actie langs je man naar de 2e paal, hoge bal, in één tik binnen.",
  category: "TECHNIEK",
  level: "GEMIDDELD",
  addedOn: "2026-11-03",
  roster: [
    { playerId: "p1", label: "1", name: STANDARD_POSITIONS[1].name },
    { playerId: "p5", label: "5", name: STANDARD_POSITIONS[5].name },
    { playerId: "p6", label: "6", name: STANDARD_POSITIONS[6].name },
  ],
  steps: [
    {
      title: "Actie voor de goal",
      text: "Vleugel 1 zwemt langs zijn man naar de tweede paal en zoekt oogcontact met 5, die de bal heeft.",
      frame: {
        ...withBallAt5,
        arrows: [
          { kind: "MOVE", playerId: "p1", to: [186, 42], via: [225, 38] },
        ],
      },
      roles: [
        {
          playerId: "p1",
          text: "Start de actie pas als 5 je ziet; zwem laag en hard langs je man.",
        },
        {
          playerId: "p5",
          text: "Hou de bal hoog en wacht tot de actie uitkomt.",
        },
        {
          playerId: "p6",
          text: "Hou je verdediger vast op de paal zodat de ruimte vrij blijft.",
        },
      ],
    },
    {
      title: "Bal hoog en droog",
      text: "Pas als 1 voorbij zijn man is speelt 5 hoog in: op strekhoogte, net buiten bereik van de keeper.",
      frame: {
        ...withBallAt5,
        players: withBallAt5.players.map((p) => {
          if (p.id === "p1") return { ...p, x: 186, y: 42 };
          if (p.id === "d1") return { ...p, x: 208, y: 56 };
          return p;
        }),
        arrows: [{ kind: "PASS", playerId: "p5", to: [176, 32] }],
      },
      roles: [
        {
          playerId: "p1",
          text: "Benen eerst (schaartrap), dan de arm omhoog; lichaam tussen bal en verdediger.",
        },
        {
          playerId: "p5",
          text: "Speel hoog en droog; een te lage bal plukt de keeper.",
        },
        {
          playerId: "p6",
          text: "Niet naar de bal toe; blijf uit de baan van de pass.",
        },
      ],
    },
    {
      title: "Tippen, niet vangen",
      text: "Met gestrekte arm tik je de bal in één beweging over of langs de keeper. Snelheid gaat vóór controle.",
      frame: {
        ...base,
        players: base.players.map((p) => {
          if (p.id === "p1") return { ...p, x: 180, y: 38 };
          if (p.id === "d1") return { ...p, x: 208, y: 56 };
          if (p.id === KEEPER_ID) return { ...p, x: 158, y: 19 };
          return p;
        }),
        arrows: [{ kind: "SHOT", playerId: "p1", to: [160, 13] }],
        ballPlayerId: "p1",
      },
      roles: [
        {
          playerId: "p1",
          text: "Eén tik, niet vangen; kijk naar de bal, niet naar de keeper.",
        },
        {
          playerId: "p5",
          text: "Direct terugzakken voor de rebound of de omschakeling.",
        },
        { playerId: "p6", text: "Klaar voor de rebound als de keeper tipt." },
      ],
    },
  ],
  keyPoints: [
    "Timing: te vroeg starten en de keeper staat al klaar.",
    "Hoog in het water: benen vóór de arm omhoog gaat.",
    "Lichaam tussen verdediger en bal, kijk naar de bal.",
  ],
  commonMistakes: [
    "Bal te laag aangespeeld, de keeper plukt hem.",
    "Bal willen vangen en dán schieten; de verdediger is er al.",
  ],
};

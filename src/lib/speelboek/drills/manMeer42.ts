import type { z } from "zod";
import type {
  DiagramFrame,
  DiagramPlayer,
  drillSchema,
} from "../../schemas/speelboek";
import { KEEPER_ID, KEEPER_POSITION } from "../lineup";

/** 4-2 positions, numbered 1 (right post) → 6 (left post). */
const O: Record<string, [number, number]> = {
  p1: [173, 46],
  p2: [228, 52],
  p3: [190, 106],
  p4: [110, 106],
  p5: [72, 52],
  p6: [127, 46],
};

/** Zone with five defenders: two on the posts, two wide, one on top. */
const ZONE_START: Record<string, [number, number]> = {
  d1: [182, 30],
  d2: [212, 68],
  d3: [150, 82],
  d4: [88, 68],
  d5: [118, 30],
};

function frame(
  zone: Record<string, [number, number]>,
  ballPlayerId: string,
  arrows: DiagramFrame["arrows"] = [],
): DiagramFrame {
  const players: DiagramPlayer[] = [
    { id: KEEPER_ID, team: "GK", ...KEEPER_POSITION },
    ...Object.entries(zone).map(([id, [x, y]]) => ({
      id,
      team: "DEF" as const,
      x,
      y,
    })),
    ...Object.entries(O).map(([id, [x, y]]) => ({
      id,
      team: "OFF" as const,
      x,
      y,
    })),
  ];
  return { attackColor: "WHITE", players, arrows, ballPlayerId };
}

/** Attacking a five-man zone with the 4-2 set-up. */
export const manMeer42: z.input<typeof drillSchema> = {
  id: "4-2-man-meer",
  title: "4-2 man-meer",
  summary:
    "Zes tegen vijf: snel rondspelen, de zone laten schuiven en het gat gebruiken.",
  category: "AANVAL",
  level: "GEMIDDELD",
  addedOn: "2026-11-03",
  counterpartId: "zone-5-tegen-6",
  roster: [
    { playerId: "p1", label: "1", name: "Paal rechts" },
    { playerId: "p2", label: "2", name: "Hoek rechts" },
    { playerId: "p3", label: "3", name: "6m rechts" },
    { playerId: "p4", label: "4", name: "6m links" },
    { playerId: "p5", label: "5", name: "Hoek links" },
    { playerId: "p6", label: "6", name: "Paal links" },
  ],
  steps: [
    {
      title: "Opstelling 4-2",
      text: "Vier spelers op de 2-meterlijn (twee op de paal, twee in de hoek), twee op 6 meter. De verdediging staat in een zone met vijf man plus keeper.",
      frame: frame(ZONE_START, "p3"),
      roles: [
        {
          playerId: "p1",
          text: "Rug naar de keeper, arm vrij, vraag de bal niet te vroeg.",
        },
        {
          playerId: "p2",
          text: "Hoog in het water, buiten de zone, klaar voor de inleg.",
        },
        {
          playerId: "p3",
          text: "Bal in de hand, kijk naar de zone, dicteer het tempo.",
        },
        {
          playerId: "p4",
          text: "Beschikbaar op 6m, hou afstand tot de verdediger.",
        },
        {
          playerId: "p5",
          text: "Hoek breed houden zodat de zone moet strekken.",
        },
        {
          playerId: "p6",
          text: "Positie vasthouden op de paal, lichaam tussen bal en verdediger.",
        },
      ],
    },
    {
      title: "Snel rondspelen",
      text: "Speel de bal snel rond over 6 meter. Dwing de zone om mee te schuiven; niet dribbelen, niet vasthouden.",
      frame: frame({ ...ZONE_START, d3: [134, 80], d2: [204, 62] }, "p3", [
        { kind: "PASS", playerId: "p3", to: [122, 106] },
      ]),
      roles: [
        {
          playerId: "p1",
          text: "Blijf op de paal, armen hoog voor een snelle inleg.",
        },
        {
          playerId: "p2",
          text: "Zak iets naar 3–4 meter als de zone naar links schuift.",
        },
        {
          playerId: "p3",
          text: "Speel direct door naar 6m links; blijf beschikbaar voor de terugpass.",
        },
        { playerId: "p4", text: "Neem aan en kijk meteen naar de hoek links." },
        {
          playerId: "p5",
          text: "Vraag de bal breed, dwing de linkerverdediger uit te stappen.",
        },
        {
          playerId: "p6",
          text: "Voel waar je man staat; klaar om vrij te komen.",
        },
      ],
    },
    {
      title: "Gat trekken",
      text: "Bal naar de hoek links. De linkerverdediger moet uitstappen; daardoor komt de paalspeler links vrij.",
      frame: frame(
        { ...ZONE_START, d3: [128, 78], d4: [78, 58], d5: [122, 32] },
        "p4",
        [{ kind: "PASS", playerId: "p4", to: [84, 62] }],
      ),
      roles: [
        {
          playerId: "p1",
          text: "Blijf buiten beeld van de keeper; geen beweging naar de bal.",
        },
        {
          playerId: "p2",
          text: "Veiligheid: kom iets naar binnen voor een eventuele counter.",
        },
        {
          playerId: "p3",
          text: "Schuif naar 5m als uitwijkoptie wanneer het dichtzit.",
        },
        {
          playerId: "p4",
          text: "Speel de hoek aan en blijf achter de bal (dekking).",
        },
        {
          playerId: "p5",
          text: "Neem aan, dreig met een schot zodat de verdediger moet komen.",
        },
        {
          playerId: "p6",
          text: "Nu vrijkomen: draai weg van je man richting de bal.",
        },
      ],
    },
    {
      title: "Afronden",
      text: "De hoekspeler legt de bal in bij de paalspeler links: direct schieten (binnenkant paal) of terugleggen naar 6 meter als de keeper al staat.",
      frame: frame(
        {
          ...ZONE_START,
          d3: [128, 78],
          d4: [78, 58],
          d5: [104, 34],
          d1: [178, 30],
        },
        "p5",
        [
          { kind: "PASS", playerId: "p5", to: [118, 46] },
          { kind: "SHOT", playerId: "p6", to: [146, 14] },
        ],
      ),
      roles: [
        {
          playerId: "p1",
          text: "Terugzakken voor de rebound of de omschakeling.",
        },
        { playerId: "p2", text: "Eerste man terug bij balverlies." },
        {
          playerId: "p3",
          text: "Klaar voor de terugpass; komt de bal, dan direct schieten.",
        },
        {
          playerId: "p4",
          text: "Dekking achter de bal, ga niet mee naar voren.",
        },
        {
          playerId: "p5",
          text: "Inleg op de paal, hoog en droog; anders terug naar 6m.",
        },
        {
          playerId: "p6",
          text: "Direct schieten, binnenkant paal; de keeper komt van de andere kant.",
        },
      ],
    },
  ],
  keyPoints: [
    "Tempo: elke pass binnen een seconde, de zone mag nooit rust krijgen.",
    "Speel de bal naar de kant waar de verdediger moet kiezen.",
    "De speler op 6m achter de bal blijft altijd staan voor de dekking.",
  ],
  commonMistakes: [
    "Bal vasthouden op 6 meter; de zone zet zich.",
    "Beide paalspelers bewegen tegelijk; dan staat niemand vrij.",
  ],
};

import type { z } from "zod";
import type {
  DiagramFrame,
  DiagramPlayer,
  drillSchema,
} from "../../schemas/speelboek";
import { KEEPER_ID, KEEPER_POSITION } from "../lineup";

/** The same 4-2 attack as in `4-2-man-meer`, seen from the zone. */
const ATTACK: Record<string, [number, number]> = {
  p1: [173, 46],
  p2: [228, 52],
  p3: [190, 106],
  p4: [110, 106],
  p5: [72, 52],
  p6: [127, 46],
};

const M_SHAPE: Record<string, [number, number]> = {
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
  keeper: [number, number] = [KEEPER_POSITION.x, KEEPER_POSITION.y],
): DiagramFrame {
  const players: DiagramPlayer[] = [
    { id: KEEPER_ID, team: "GK", x: keeper[0], y: keeper[1] },
    ...Object.entries(zone).map(([id, [x, y]]) => ({
      id,
      team: "DEF" as const,
      x,
      y,
    })),
    ...Object.entries(ATTACK).map(([id, [x, y]]) => ({
      id,
      team: "OFF" as const,
      x,
      y,
    })),
  ];
  return { attackColor: "WHITE", players, arrows, ballPlayerId };
}

/** Defending a man-down with five in an M-shape. */
export const zone56: z.input<typeof drillSchema> = {
  id: "zone-5-tegen-6",
  title: "Zone 5 tegen 6: M-verdediging",
  summary:
    "Vijf man in een M: paalspelers afschermen, met de bal meeschuiven, nooit twee tegelijk uitstappen.",
  category: "VERDEDIGING",
  level: "GEMIDDELD",
  addedOn: "2026-11-03",
  counterpartId: "4-2-man-meer",
  roster: [
    { playerId: "d1", label: "R", name: "Paal rechts (voor)" },
    { playerId: "d2", label: "RB", name: "Rechts buiten" },
    { playerId: "d3", label: "P", name: "Punt" },
    { playerId: "d4", label: "LB", name: "Links buiten" },
    { playerId: "d5", label: "L", name: "Paal links (voor)" },
    { playerId: KEEPER_ID, label: "K", name: "Keeper" },
  ],
  steps: [
    {
      title: "De M staat",
      text: "Twee verdedigers vóór de paalspelers, twee buiten op ongeveer 4 meter, één op de punt. Armen omhoog, kijk naar de bal én je man.",
      frame: frame(M_SHAPE, "p3"),
      roles: [
        {
          playerId: "d1",
          text: "Sta vóór de paalspeler rechts, arm in de paslijn.",
        },
        {
          playerId: "d2",
          text: "Blokkeer de schotlijn van de hoek rechts, blijf op 4 meter.",
        },
        {
          playerId: "d3",
          text: "Druk op de balbezitter op 6 meter zonder uit te stappen.",
        },
        { playerId: "d4", text: "Blokkeer de schotlijn van de hoek links." },
        {
          playerId: "d5",
          text: "Sta vóór de paalspeler links, arm in de paslijn.",
        },
        {
          playerId: KEEPER_ID,
          text: "Hoog in het water, positie op de bal, roep wie uitstapt.",
        },
      ],
    },
    {
      title: "Meeschuiven met de bal",
      text: "Gaat de bal over 6 meter naar links, dan schuift de hele M een stap mee. De punt volgt de bal, de buitenspelers blijven in de schotlijn.",
      frame: frame({ ...M_SHAPE, d3: [134, 80], d2: [204, 62] }, "p4", [
        { kind: "PASS", playerId: "p3", to: [122, 106] },
      ]),
      roles: [
        { playerId: "d1", text: "Blijf bij je paalspeler; de bal is ver weg." },
        {
          playerId: "d2",
          text: "Zak iets naar binnen, je hoek is nu geen gevaar.",
        },
        { playerId: "d3", text: "Volg de bal naar links, armen omhoog." },
        { playerId: "d4", text: "Hou de schotlijn van de hoek links dicht." },
        {
          playerId: "d5",
          text: "Kom iets naar buiten: de inleg op links wordt gevaarlijk.",
        },
        {
          playerId: KEEPER_ID,
          text: "Verplaats mee naar de balzijde, blijf op de lijn.",
        },
      ],
    },
    {
      title: "Eén man stapt uit",
      text: "Bal in de hoek links: alleen de linkerbuitenspeler stapt uit richting de schutter. De rest blijft staan; niemand volgt hem.",
      frame: frame(
        { ...M_SHAPE, d3: [128, 78], d4: [78, 58], d5: [122, 32] },
        "p5",
        [{ kind: "MOVE", playerId: "d4", to: [76, 56] }],
      ),
      roles: [
        {
          playerId: "d1",
          text: "Blijf staan; de verleiding om te helpen is de fout.",
        },
        {
          playerId: "d2",
          text: "Blijf in de schotlijn van rechts, klaar voor de snelle wissel.",
        },
        {
          playerId: "d3",
          text: "Kom naar het midden, dek de terugpass naar 6m.",
        },
        {
          playerId: "d4",
          text: "Uitstappen met de arm omhoog, blok het schot, geen fout maken.",
        },
        {
          playerId: "d5",
          text: "Schuif naar binnen en pak de paalspeler links over.",
        },
        {
          playerId: KEEPER_ID,
          text: "Verwacht het schot van de hoek; korte hoek dicht.",
        },
      ],
    },
    {
      title: "Herstellen",
      text: "Wordt de bal teruggespeeld, dan zakt de buitenspeler terug en staat de M weer. Bij balverlies van de aanval: meteen omschakelen.",
      frame: frame({ ...M_SHAPE, d3: [134, 80] }, "p4", [
        { kind: "PASS", playerId: "p5", to: [120, 100] },
        { kind: "MOVE", playerId: "d4", to: [88, 70] },
      ]),
      roles: [
        { playerId: "d1", text: "Positie houden tot de bal weg is." },
        {
          playerId: "d2",
          text: "Eerste man in de counter als we de bal winnen.",
        },
        { playerId: "d3", text: "Terug naar de punt, druk op 6m." },
        { playerId: "d4", text: "Terug naar 4 meter, arm weer omhoog." },
        {
          playerId: "d5",
          text: "Terug vóór je eigen paalspeler zodra de buitenspeler terug is.",
        },
        { playerId: KEEPER_ID, text: "Snel uitgooien bij balwinst." },
      ],
    },
  ],
  keyPoints: [
    "Armen altijd omhoog; een zone met lage armen is geen zone.",
    "Praat: de keeper stuurt wie uitstapt.",
    "Maximaal één speler uit positie tegelijk.",
  ],
  commonMistakes: [
    "Twee verdedigers stappen uit op dezelfde bal.",
    "Paalspeler loslaten om de hoek te helpen.",
  ],
};

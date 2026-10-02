import { MissionDefinitionSchema, type MissionDefinition } from "./types";
import { EXPANSION_MISSIONS } from "./expansion";

/** First complete contract used to validate the street-contact-to-payout flow. */
export const MISDELIVERED_PARCEL: MissionDefinition =
  MissionDefinitionSchema.parse({
    id: "M01",
    version: 1,
    title: "Verkeerd bezorgd",
    contact: "noor",
    zone: "rhenen",
    prerequisites: [],
    estimatedSeconds: 240,
    basePay: 250,
    bonus: {
      amount: 75,
      label: "Binnen drie minuten",
      rule: { kind: "time", seconds: 180 },
    },
    briefing: [
      {
        speaker: "Noor",
        text: "Een pakketje voor meneer Postma. Niet schudden. Als het tikt, is het waarschijnlijk een klok.",
      },
      { speaker: "Jij", text: "Waarschijnlijk?" },
      {
        speaker: "Noor",
        text: "Haal het op bij mijn krat en lees het briefje. Het adres staat erop. Binnen drie minuten krijg je €75 extra.",
      },
    ],
    success: [
      {
        speaker: "Postma",
        text: "Mijn klok! Eindelijk. Het oude adres stond zeker nog op de doos?",
      },
      {
        speaker: "Noor",
        text: "Netjes afgeleverd. Je geld staat klaar; voor de volgende klus weet je me te vinden.",
      },
    ],
    failure:
      "Het pakket is niet afgeleverd. Noor heeft een nieuwe bezorgpoging voor je.",
    stages: [
      {
        id: "parcel",
        text: "Haal het pakket op bij Noors krat.",
        hints: [
          "De krat staat naast Noor, bij het zwembad.",
          "Loop naar het pakketicoon en druk op de interactieknop.",
        ],
        dialogue: [
          {
            speaker: "Noor",
            text: "Die met de gele sticker. De andere is mijn lunch.",
          },
        ],
        objective: { kind: "collect", targets: ["parcel"] },
      },
      {
        id: "note",
        text: "Lees het bezorgbriefje bij de krat.",
        hints: [
          "Naast de krat hangt een briefje met het adres.",
          "Blijf bij het briefje staan en houd de interactieknop één seconde vast.",
        ],
        dialogue: [
          {
            speaker: "Bezorgbriefje",
            text: "Voor meneer Postma. Bezorgadres: de gemarkeerde voordeur bij de Cunerakerk.",
          },
        ],
        objective: { kind: "interact", target: "note", seconds: 1 },
      },
      {
        id: "old-address",
        text: "Ga naar het adres bij de Cunerakerk.",
        hints: [
          "De gele route brengt je naar de voordeur.",
          "Volg de route naar het huisicoon. Het pakket blijft bij je, ook als je instapt.",
        ],
        dialogue: [
          {
            speaker: "Noor",
            text: "Je mag lopen of een auto pakken. Als het pakket maar heel aankomt.",
          },
        ],
        objective: { kind: "reach", target: "old-door", radius: 4 },
      },
      {
        id: "neighbour",
        text: "Vraag de buurvrouw waar Postma nu woont.",
        hints: [
          "De buurvrouw staat naast de gemarkeerde voordeur.",
          "Stap uit en praat met de buurvrouw. Zij geeft je het nieuwe adres.",
        ],
        dialogue: [
          {
            speaker: "Buurvrouw",
            text: "Postma? Die is verhuisd. Hij woont nu verderop, bij de groene brievenbus.",
          },
          { speaker: "Jij", text: "Ik pas de route aan. Bedankt!" },
        ],
        objective: { kind: "talk", target: "neighbour" },
      },
      {
        id: "delivery",
        text: "Lever het pakket af bij Postma op het nieuwe adres.",
        hints: [
          "Je nieuwe bestemming staat op de kaart.",
          "Ga naar de groene brievenbus, stop en geef het pakket aan Postma met de interactieknop.",
        ],
        dialogue: [
          {
            speaker: "Postma",
            text: "Hier moet je zijn! Gelukkig klopt de naam nog wel.",
          },
        ],
        objective: { kind: "deliver", target: "recipient", items: ["parcel"] },
      },
    ],
  });

/** Authored contracts available to the simulation and every input/render surface. */
export const MISSION_CATALOG: readonly MissionDefinition[] = [
  MISDELIVERED_PARCEL,
  ...EXPANSION_MISSIONS,
];

/** Finds a contract by its stable authored ID. */
export function missionById(id: string): MissionDefinition | undefined {
  return MISSION_CATALOG.find((mission) => mission.id === id);
}

/** Validates stage references and progress paths before content enters the simulation. */
export function validateMissionGraph(definition: MissionDefinition): string[] {
  const errors: string[] = [];
  const ids = definition.stages.map((stage) => stage.id);
  if (new Set(ids).size !== ids.length)
    errors.push(`${definition.id}: dubbele stapnaam`);
  const visited = new Set<number>();
  let index = 0;
  while (index >= 0 && index < definition.stages.length) {
    if (visited.has(index)) {
      errors.push(`${definition.id}: cyclus bij ${ids[index]}`);
      break;
    }
    visited.add(index);
    const stage = definition.stages[index];
    index = stage.next ? ids.indexOf(stage.next) : index + 1;
    if (index < 0)
      errors.push(`${definition.id}: onbekende vervolgstap ${stage.next}`);
  }
  if (visited.size < definition.stages.length)
    errors.push(`${definition.id}: onbereikbare stap`);
  return errors;
}

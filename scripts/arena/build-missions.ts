import { readFile } from "node:fs/promises";
import path from "node:path";
import { MAP_VERSION } from "../../src/lib/cityArena/constants";
import { MISSION_CONTACTS } from "../../src/lib/cityArena/missions/contacts";
import { EXPANSION_MISSIONS } from "../../src/lib/cityArena/missions/expansion";
import { missionLocationDefinitions } from "../../src/lib/cityArena/missions/locations";
import {
  resolveMissionAnchor,
  type MissionAnchorDefinition,
} from "../../src/lib/cityArena/missions/anchors";
import {
  isMapRoads,
  isMapTile,
  parseMapIndex,
} from "../../src/lib/cityArena/schemas";
import { createCollisionGrid } from "../../src/lib/cityArena/world/collisionGrid";
import { decodeTile } from "../../src/lib/cityArena/world/decode";
import { decodeRoadGraph } from "../../src/lib/cityArena/world/roadGraph";
import { createRoadCorridors } from "../../src/lib/cityArena/world/roadCorridor";
import { readIfPresent, writeAtomic } from "./files";

async function main(): Promise<void> {
  const mapRoot = path.resolve(`public/arena/map/${MAP_VERSION}`);
  const index = parseMapIndex(
    JSON.parse(await readFile(path.join(mapRoot, "index.json"), "utf8")),
  );
  const roadData: unknown = JSON.parse(
    await readFile(path.join(mapRoot, "roads.json"), "utf8"),
  );
  if (!isMapRoads(roadData)) throw new Error("De wegenkaart is ongeldig");
  const graph = decodeRoadGraph(roadData);
  const collision = createCollisionGrid(16, createRoadCorridors(graph));
  for (const tile of index.tiles) {
    const data: unknown = JSON.parse(
      await readFile(path.join(mapRoot, tile.file), "utf8"),
    );
    if (!isMapTile(data)) throw new Error(`Ongeldige kaarttegel: ${tile.file}`);
    collision.insertTile(decodeTile(data, index));
  }
  const definitions: MissionAnchorDefinition[] = [
    ...EXPANSION_MISSIONS.flatMap((mission) =>
      missionLocationDefinitions(mission, index),
    ),
    ...MISSION_CONTACTS.map((contact): MissionAnchorDefinition => ({
      id: contact.id,
      zone: contact.zone,
      landmark: contact.landmark,
      offset: contact.offset,
      mode: "foot",
    })),
    {
      id: "M01:parcel",
      zone: "rhenen",
      landmark: "gastland",
      offset: [3, 140],
      mode: "foot",
    },
    {
      id: "M01:note",
      zone: "rhenen",
      landmark: "gastland",
      offset: [6, 140],
      mode: "foot",
    },
    {
      id: "M01:old-door",
      zone: "rhenen",
      landmark: "cunerakerk",
      offset: [40, 40],
      mode: "foot",
    },
    {
      id: "M01:neighbour",
      zone: "rhenen",
      landmark: "cunerakerk",
      offset: [40, 44],
      mode: "foot",
    },
    {
      id: "M01:recipient",
      zone: "rhenen",
      landmark: "cunerakerk",
      offset: [-110, -20],
      mode: "foot",
    },
  ];
  const anchors = definitions.map((definition) =>
    resolveMissionAnchor(definition, index, graph, collision),
  );
  const contents =
    JSON.stringify({ mapVersion: MAP_VERSION, anchors }, null, 2) + "\n";
  const output = "src/lib/cityArena/missions/anchors.generated.json";
  if (process.argv.includes("--check")) {
    const stored = await readIfPresent(output);
    if (
      !stored ||
      JSON.stringify(JSON.parse(stored)) !==
        JSON.stringify(JSON.parse(contents))
    )
      throw new Error("Missieankers wijken af; voer arena:build-missions uit");
  } else await writeAtomic(output, contents);
  console.log(
    `arena missions: ${anchors.length} bereikbare locaties binnen de speelzones gecontroleerd.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Missiekaart kon niet worden opgebouwd",
  );
  process.exitCode = 1;
});

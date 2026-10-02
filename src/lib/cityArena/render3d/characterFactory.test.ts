import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterAssets } from "./characterAssets";
import { modelOf } from "./characterAppearance";
import {
  createCharacterFactory,
  type CharacterAssetSource,
} from "./characters";
import type { CharacterWho } from "./entities";
import { isGltfCharacter } from "./gltfCharacter";
import { fixtureCharacterAssets } from "./testing/gltfFixture";

const ASSETS = fixtureCharacterAssets();

/** A source that is loaded or not, counting the requests to load. */
function sourceOf(assets: CharacterAssets | null): CharacterAssetSource & {
  request: ReturnType<typeof vi.fn>;
} {
  return { ready: () => assets, request: vi.fn() };
}

const NEAR: CharacterWho = { id: 20, simple: false };
const FAR: CharacterWho = { id: 20, simple: true };

describe("createCharacterFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds procedural characters until the glTF cast has loaded, asking for it", () => {
    const source = sourceOf(null);
    const factory = createCharacterFactory(source);
    const character = factory.character("ped1", undefined, NEAR);
    expect(isGltfCharacter(character)).toBe(false);
    expect(character.object.name).toBe("character:ped1");
    expect(factory.characterVariant?.("ped1", undefined, NEAR)).toBe("ped1");
    expect(factory.characterVariant?.("otherPlayer", 0.4, NEAR)).toBeNull();
    expect(source.request).toHaveBeenCalled();
  });

  it("builds the glTF character of the entity's id once loaded", () => {
    const source = sourceOf(ASSETS);
    const factory = createCharacterFactory(source);
    const character = factory.character("ped1", undefined, NEAR);
    expect(isGltfCharacter(character)).toBe(true);
    const model = modelOf("ped1", NEAR.id);
    expect(factory.characterVariant?.("ped1", undefined, NEAR)).toBe(
      `gltf:${model}`,
    );
    expect(source.request).not.toHaveBeenCalled();
  });

  it("keeps a far character procedural (the 'laag' level of detail)", () => {
    const factory = createCharacterFactory(sourceOf(ASSETS));
    expect(isGltfCharacter(factory.character("cop", undefined, FAR))).toBe(
      false,
    );
    expect(factory.characterVariant?.("cop", undefined, FAR)).toBe("cop");
  });

  it("re-dresses a pooled glTF character for its next owner", () => {
    const factory = createCharacterFactory(sourceOf(ASSETS));
    const character = factory.character("player", undefined, NEAR);
    const scale = character.object.children[0]!.scale.x;
    const beachId = Array.from({ length: 500 }, (_, id) => id).find(
      (id) => modelOf("ped1", id) === "beach-man",
    );
    factory.dressCharacter?.(character, "ped1", undefined, {
      id: beachId ?? 0,
      simple: false,
    });
    expect(character.object.children[0]!.scale.x).not.toBe(scale);
  });
});

/**
 * The mission contacts in 3D (the 2D `drawMissions`): each contact stands at their spot on the
 * street as a character in the look the 2D map draws them in, idle and unarmed, turning to you
 * when you come close. They come from the cast's character factory and its pools, like everyone
 * else in the street.
 */
import { Group } from "three";
import type { Scene } from "../render/renderScene";
import type { CharacterLook } from "./characterLooks";
import type { PoseInput } from "./characterPose";
import type { Character3d } from "./characters";
import { headingToRotationY, setWorldPosition } from "./coords";
import {
  CHARACTER_DRAW_DISTANCE_M,
  FREE_LIST_CAP,
  type CharacterWho,
  type EntityFactories,
} from "./entities";
import { createEntityPool, type EntityPool, type PoolSlot } from "./entityPool";
import type { ContactSpot } from "./missionMarkers";

/** A contact turns to face you within this distance, metres. */
export const CONTACT_FACE_RANGE_M = 12;
/** Otherwise they face south, toward the viewer, as the 2D map draws them. */
const CONTACT_REST_FACING = Math.PI / 2;
/** FNV-1a's offset basis and prime, for a contact's id as a number. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** The factory hooks the contacts use. */
type ContactFactories = Pick<
  EntityFactories,
  "character" | "characterVariant" | "dressCharacter"
>;
type ContactPool = EntityPool<Character3d, CharacterLook, string>;

/** What the contacts read from a frame's scene. */
export type ContactsScene = Pick<Scene, "players" | "localPlayerId" | "tick">;

/** The contacts on the street. */
export type Contacts3d = {
  /** Add to the scene once. */
  object: Group;
  /**
   * Stands the contacts within the characters' draw distance of `focus` and frees the rest.
   *
   * @param contacts - The mission markers' contacts.
   * @param scene - The frame's players and tick.
   * @param focus - The camera focus, world metres.
   */
  update(
    contacts: readonly ContactSpot[],
    scene: ContactsScene,
    focus: { x: number; y: number },
  ): void;
  /** Disposes every character, standing or freed. */
  dispose(): void;
};

/** True when `(x, y)` lies within `distance` of `from`. */
function near(
  from: { x: number; y: number },
  x: number,
  y: number,
  distance: number,
): boolean {
  const dx = x - from.x;
  const dy = y - from.y;
  return dx * dx + dy * dy <= distance * distance;
}

/** The heading a contact faces: toward you when you are close, else the map's rest facing. */
function facingOf(contact: ContactSpot, scene: ContactsScene): number {
  for (const player of scene.players) {
    if (player.id !== scene.localPlayerId) continue;
    if (!near(contact, player.x, player.y, CONTACT_FACE_RANGE_M)) break;
    return Math.atan2(player.y - contact.y, player.x - contact.x);
  }
  return CONTACT_REST_FACING;
}

/**
 * A contact's id as a stable number (32-bit FNV-1a), which dresses their glTF character.
 *
 * @param id - The contact's id.
 * @returns An unsigned 32-bit integer.
 */
export function contactSeed(id: string): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** The pool variant of a contact's character: the factory's, else the look. */
function variantOf(
  factories: ContactFactories,
  look: CharacterLook,
  who: CharacterWho,
): string | null {
  return factories.characterVariant?.(look, undefined, who) ?? look;
}

/** A contact's character: kept while it still fits, else a freed one re-dressed, else a new one. */
function contactSlot(
  factories: ContactFactories,
  pool: ContactPool,
  contact: ContactSpot,
  who: CharacterWho,
): PoolSlot<Character3d, CharacterLook> {
  const { look } = contact;
  who.id = contactSeed(contact.id);
  const variant = variantOf(factories, look, who);
  const kept = pool.keep(contact.id);
  if (kept?.state === look && kept.variant === variant) return kept;
  let built = false;
  const create = (): Character3d => {
    built = true;
    return factories.character(look, undefined, who);
  };
  const slot = pool.claim(contact.id, variant, create, look);
  if (!built) factories.dressCharacter?.(slot.item, look, undefined, who);
  return slot;
}

/**
 * Creates the contacts.
 *
 * @param factories - Builds the characters: the cast's factory.
 * @returns The contacts; call `update` every frame with the mission markers' contacts.
 */
export function createContacts3d(factories: ContactFactories): Contacts3d {
  const object = new Group();
  object.name = "contacts";
  const pool = createEntityPool<Character3d, CharacterLook, string>(
    object,
    FREE_LIST_CAP,
  );
  const pose: PoseInput = {
    speed: 0,
    phaseM: 0,
    aiming: false,
    weapon: null,
    dead: false,
    tick: 0,
    recoil: 0,
  };
  const who: CharacterWho = { id: 0, simple: false };
  return {
    object,
    update(contacts, scene, focus) {
      pool.begin();
      pose.tick = scene.tick;
      for (const contact of contacts) {
        if (!near(focus, contact.x, contact.y, CHARACTER_DRAW_DISTANCE_M))
          continue;
        const character = contactSlot(factories, pool, contact, who).item;
        setWorldPosition(character.object.position, contact.x, contact.y);
        character.object.rotation.y = headingToRotationY(
          facingOf(contact, scene),
        );
        character.update(pose);
      }
      pool.end();
    },
    dispose: () => pool.dispose(),
  };
}

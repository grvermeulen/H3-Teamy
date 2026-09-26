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
  type EntityFactories,
} from "./entities";
import { createEntityPool } from "./entityPool";
import type { ContactSpot } from "./missionMarkers";

/** A contact turns to face you within this distance, metres. */
export const CONTACT_FACE_RANGE_M = 12;
/** Otherwise they face south, toward the viewer, as the 2D map draws them. */
const CONTACT_REST_FACING = Math.PI / 2;

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
 * Creates the contacts.
 *
 * @param factories - Builds the characters: the cast's factory.
 * @returns The contacts; call `update` every frame with the mission markers' contacts.
 */
export function createContacts3d(
  factories: Pick<EntityFactories, "character">,
): Contacts3d {
  const object = new Group();
  object.name = "contacts";
  const pool = createEntityPool<Character3d, CharacterLook>(
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
  return {
    object,
    update(contacts, scene, focus) {
      pool.begin();
      pose.tick = scene.tick;
      for (const contact of contacts) {
        if (!near(focus, contact.x, contact.y, CHARACTER_DRAW_DISTANCE_M))
          continue;
        const kept = pool.keep(contact.key);
        const slot =
          kept?.state === contact.look
            ? kept
            : pool.claim(
                contact.key,
                contact.look,
                () => factories.character(contact.look),
                contact.look,
              );
        const character = slot.item;
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

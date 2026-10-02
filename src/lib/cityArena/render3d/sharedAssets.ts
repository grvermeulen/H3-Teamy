/**
 * The geometries and materials render3d modules build once and share between every character,
 * vehicle, pickup and weapon — cached at module level, so they would outlive the view that made
 * them. Once three.js has drawn them they carry its dispose listeners, which keep that view's
 * renderer reachable; a player toggling 2D↔3D would pile up old renderers. The view frees them all
 * on `dispose()`, and the next view rebuilds each on first use.
 */
import { disposeAccessoryGeometries } from "./characterAccessories";
import { disposeGltfCarAssets } from "./carAssets";
import { disposeGltfCharacterAssets } from "./characterAssets";
import { disposeCharacterAssets } from "./characterRig";
import { disposeCockpitAssets } from "./cockpit3d";
import { disposeDriveByAssets } from "./driveBy3d";
import { disposeGltfVehicleParts } from "./gltfVehicle";
import { disposePickupAssets } from "./pickups3d";
import { disposeVehicleMaterials } from "./vehicleParts";
import { disposeWeaponGeometries } from "./weapons3d";

/**
 * Frees and forgets every module-level shared geometry and material: the characters' materials and
 * merged looks, the loaded glTF cast and its accessories, the loaded Kenney cars and the geometry
 * built from them, the vehicles' paint, detail, lamp and matte materials, the pickups' glow and health box, the weapons' merged models, the first-person
 * cockpits' geometry and glass, and the drive-by arms. Call once the view using them is torn down.
 */
export function disposeSharedAssets(): void {
  disposeCharacterAssets();
  disposeGltfCharacterAssets();
  disposeAccessoryGeometries();
  disposeGltfVehicleParts();
  disposeGltfCarAssets();
  disposeVehicleMaterials();
  disposePickupAssets();
  disposeWeaponGeometries();
  disposeCockpitAssets();
  disposeDriveByAssets();
}

import type { Material, Object3D, Texture } from "three";

/** The texture slots a three.js material may carry. */
const TEXTURE_KEYS = [
  "map",
  "emissiveMap",
  "alphaMap",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
] as const;

/** Textures a material holds, in any of {@link TEXTURE_KEYS}. */
function texturesOf(material: Material): Texture[] {
  const slots = material as unknown as Partial<Record<string, Texture | null>>;
  return TEXTURE_KEYS.flatMap((key) => {
    const texture = slots[key];
    return texture ? [texture] : [];
  });
}

/** Anything with a `dispose` method. */
type Disposable = { dispose(): void };

/**
 * Frees the GPU memory of everything under `root`: each geometry, material and material texture
 * exactly once, even when several meshes share them.
 *
 * @param root - The subtree to release; it stays in its parent — detach it yourself.
 */
export function disposeObject(root: Object3D): void {
  const seen = new Set<Disposable>();
  const release = (item: Disposable): void => {
    if (seen.has(item)) return;
    seen.add(item);
    item.dispose();
  };
  root.traverse((node) => {
    const mesh = node as Partial<{
      geometry: Disposable;
      material: Material | Material[];
    }>;
    if (mesh.geometry) release(mesh.geometry);
    const materials = mesh.material
      ? Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      : [];
    for (const material of materials) {
      for (const texture of texturesOf(material)) release(texture);
      release(material);
    }
  });
}

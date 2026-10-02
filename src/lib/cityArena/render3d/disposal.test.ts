import { describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshLambertMaterial, Texture } from "three";
import { disposeObject } from "./disposal";

describe("disposeObject", () => {
  it("disposes shared geometry, material and texture exactly once", () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const texture = new Texture();
    const material = new MeshLambertMaterial({ map: texture });
    const root = new Group();
    root.add(new Mesh(geometry, material), new Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");

    disposeObject(root);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("handles meshes with a material array", () => {
    const first = new MeshLambertMaterial();
    const second = new MeshLambertMaterial();
    const mesh = new Mesh(new BoxGeometry(), [first, second]);
    const firstDispose = vi.spyOn(first, "dispose");
    const secondDispose = vi.spyOn(second, "dispose");

    disposeObject(mesh);

    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).toHaveBeenCalledOnce();
  });
});

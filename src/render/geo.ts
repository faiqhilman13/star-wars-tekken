import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Paint a geometry with a flat vertex color so many parts can share one material. */
export function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Vertical gradient paint (bottom → top) for cloth shading variation. */
export function paintGradient(
  geometry: THREE.BufferGeometry,
  bottom: THREE.ColorRepresentation,
  top: THREE.ColorRepresentation,
): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  const pos = geometry.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();
  const span = Math.max(1e-5, box.max.y - box.min.y);
  for (let i = 0; i < pos.count; i += 1) {
    const t = (pos.getY(i) - box.min.y) / span;
    tmp.copy(a).lerp(b, t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((g) => {
    const geometry = g.index ? g.toNonIndexed() : g;
    if (!geometry.getAttribute('uv')) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') geometry.deleteAttribute(name);
    }
    return geometry;
  });
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('mergeGeometries failed');
  merged.computeBoundingSphere();
  return merged;
}

/** Limb segment hanging from its joint: top at y = 0, extending to y = -length. */
export function limb(rTop: number, rBottom: number, length: number, radial = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, radial, 1, false);
  g.translate(0, -length / 2, 0);
  return g;
}

/** Segment rising from its joint: bottom at y = 0, extending to y = +length. */
export function riser(rBottom: number, rTop: number, length: number, radial = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, radial, 1, false);
  g.translate(0, length / 2, 0);
  return g;
}

export function ball(radius: number, sx = 1, sy = 1, sz = 1, segments = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, segments, Math.max(8, Math.floor(segments * 0.75)));
  g.scale(sx, sy, sz);
  return g;
}

export function rbox(x: number, y: number, z: number, radius: number, segments = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(x, y, z, segments, Math.min(radius, Math.min(x, y, z) / 2 - 1e-4));
}

export function at(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.translate(x, y, z);
  return g;
}

export function rotX(g: THREE.BufferGeometry, deg: number): THREE.BufferGeometry {
  g.rotateX(THREE.MathUtils.degToRad(deg));
  return g;
}

export function rotY(g: THREE.BufferGeometry, deg: number): THREE.BufferGeometry {
  g.rotateY(THREE.MathUtils.degToRad(deg));
  return g;
}

export function rotZ(g: THREE.BufferGeometry, deg: number): THREE.BufferGeometry {
  g.rotateZ(THREE.MathUtils.degToRad(deg));
  return g;
}

/** Open cone/cylinder shell segment (for skirts, sleeves, hoods). */
export function shell(
  rTop: number,
  rBottom: number,
  height: number,
  thetaStart: number,
  thetaLength: number,
  radial = 16,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, 2, true, thetaStart, thetaLength);
  g.translate(0, -height / 2, 0);
  return g;
}

/** Organic torso-like solid: a lathe of [radius, y] points, scaled to depth (x) and width (z). */
export function lathe(profile: Array<[number, number]>, depth = 1, width = 1, segments = 18): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.scale(depth, 1, width);
  g.computeVertexNormals();
  return g;
}

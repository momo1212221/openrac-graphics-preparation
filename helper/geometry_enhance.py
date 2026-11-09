#!/usr/bin/env python3
"""Deterministic glTF geometry refinement for OpenRAC exported assets.

The processor intentionally stays conservative:
- it only rewrites triangle primitives with a single local .bin buffer;
- UVs, colours, joints and weights are interpolated during subdivision;
- skeleton/bone names, nodes, skins, animations, materials and images stay untouched;
- vertex positions move only when explicit shape_refine is enabled;
- collision is never silently changed.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
import struct
from typing import Iterable

_COMPONENTS = {
    5120: ("b", 1, -128, 127),
    5121: ("B", 1, 0, 255),
    5122: ("h", 2, -32768, 32767),
    5123: ("H", 2, 0, 65535),
    5125: ("I", 4, 0, 4294967295),
    5126: ("f", 4, None, None),
}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
_SUPPORTED = {
    "POSITION", "NORMAL", "TANGENT", "TEXCOORD_0", "TEXCOORD_1",
    "COLOR_0", "JOINTS_0", "WEIGHTS_0",
}


@dataclass(frozen=True)
class GeometryProfile:
    mode: str
    subdivisions: int
    triangle_budget: int
    shape_relax: float
    recalc_normals: bool = True
    recalc_tangents: bool = True
    adaptive_subdivision: bool = True
    crease_angle_degrees: float = 55.0


def _kind(path: Path) -> str:
    parts = {part.lower() for part in path.parts}
    if "terrain" in parts:
        return "terrain"
    if any(part.startswith("moby_") for part in path.parts) or "mobys" in parts:
        return "moby"
    if "ties" in parts:
        return "tie"
    if "shrubs" in parts:
        return "shrub"
    return "generic"


def geometry_profile(mode: str, kind: str, options: dict | None = None) -> GeometryProfile:
    options = options or {}
    if mode not in {"enhanced", "high", "ultra", "modern", "experimental"}:
        raise ValueError("geometry profile must be enhanced, high, ultra, modern or experimental")
    defaults = {
        "terrain": 240_000,
        "moby": 60_000,
        "tie": 80_000,
        "shrub": 80_000,
        "generic": 60_000,
    }
    modern_defaults = {
        "terrain": 360_000,
        "moby": 120_000,
        "tie": 140_000,
        "shrub": 140_000,
        "generic": 100_000,
    }
    requested = {"enhanced": 0, "high": 1, "ultra": 2, "modern": 2, "experimental": 2}[mode]
    override = options.get("triangle_budget")
    base_defaults = modern_defaults if mode == "modern" else defaults
    budget = int(override) if isinstance(override, (int, float)) else base_defaults.get(kind, 60_000)
    budget = max(256, min(1_000_000, budget))
    refine = bool(options.get("shape_refine", False))
    relax = 0.0
    if refine:
        relax = {"enhanced": 0.0, "high": 0.006, "ultra": 0.012, "modern": 0.010, "experimental": 0.025}[mode]
        # Moving gameplay/terrain surfaces against original collision is opt-in twice.
        if kind in {"moby", "terrain"} and not bool(options.get("allow_collision_mismatch", False)):
            relax = 0.0
    adaptive = options.get("adaptive_subdivision", True) is not False
    crease_defaults = {"terrain": 75.0, "moby": 50.0, "tie": 55.0, "shrub": 55.0, "generic": 55.0}
    crease_raw = options.get("crease_angle_degrees", crease_defaults.get(kind, 55.0))
    crease = max(30.0, min(120.0, float(crease_raw)))
    return GeometryProfile(
        mode, requested, budget, relax,
        adaptive_subdivision=adaptive,
        crease_angle_degrees=crease,
    )


def _normalise(values: Iterable[float], fallback: tuple[float, ...] | None = None) -> tuple[float, ...]:
    v = tuple(float(x) for x in values)
    length = math.sqrt(sum(x * x for x in v))
    if not math.isfinite(length) or length < 1e-12:
        return fallback or tuple(0.0 for _ in v)
    return tuple(x / length for x in v)


def _decode_component(value, component: int, normalised: bool) -> float | int:
    if component == 5126 or not normalised:
        return value
    _, _, lo, hi = _COMPONENTS[component]
    if lo is None or hi is None:
        return value
    if lo < 0:
        return max(-1.0, float(value) / float(hi))
    return float(value) / float(hi)


def read_accessor(doc: dict, blob: bytes | bytearray, accessor_index: int) -> list[tuple]:
    accessor = doc["accessors"][accessor_index]
    if "sparse" in accessor:
        raise ValueError("sparse accessors are not supported by Geometry Enhancement v1")
    view = doc["bufferViews"][accessor["bufferView"]]
    if int(view.get("buffer", 0)) != 0:
        raise ValueError("only the primary local glTF buffer is supported")
    component = int(accessor["componentType"])
    if component not in _COMPONENTS:
        raise ValueError(f"unsupported component type {component}")
    type_name = accessor["type"]
    if type_name not in _WIDTH:
        raise ValueError(f"unsupported accessor type {type_name}")
    width = _WIDTH[type_name]
    fmt, size, _, _ = _COMPONENTS[component]
    stride = int(view.get("byteStride", width * size))
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    count = int(accessor["count"])
    unpack = struct.Struct("<" + fmt * width)
    normalised = bool(accessor.get("normalized", False))
    out = []
    for row in range(count):
        offset = start + row * stride
        raw = unpack.unpack_from(blob, offset)
        out.append(tuple(_decode_component(v, component, normalised) for v in raw))
    return out


def _append_accessor(
    doc: dict,
    blob: bytearray,
    values: list[tuple],
    *,
    component: int,
    type_name: str,
    target: int,
    include_bounds: bool = False,
) -> int:
    while len(blob) % 4:
        blob.append(0)
    offset = len(blob)
    fmt, _, _, _ = _COMPONENTS[component]
    width = _WIDTH[type_name]
    pack = struct.Struct("<" + fmt * width)
    for row in values:
        if len(row) != width:
            raise ValueError("accessor width mismatch")
        if component == 5126:
            pack.pack_into(blob, len(blob), *[]) if False else None
            blob.extend(pack.pack(*(float(x) for x in row)))
        else:
            blob.extend(pack.pack(*(int(x) for x in row)))
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(blob) - offset, "target": target}
    doc.setdefault("bufferViews", []).append(view)
    accessor = {
        "bufferView": len(doc["bufferViews"]) - 1,
        "componentType": component,
        "count": len(values),
        "type": type_name,
    }
    if include_bounds and values:
        accessor["min"] = [min(row[i] for row in values) for i in range(width)]
        accessor["max"] = [max(row[i] for row in values) for i in range(width)]
    doc.setdefault("accessors", []).append(accessor)
    return len(doc["accessors"]) - 1


def _midpoint_skin(joints_a, weights_a, joints_b, weights_b):
    merged: dict[int, float] = {}
    for joints, weights in ((joints_a, weights_a), (joints_b, weights_b)):
        for joint, weight in zip(joints, weights):
            merged[int(joint)] = merged.get(int(joint), 0.0) + 0.5 * max(0.0, float(weight))
    best = sorted(merged.items(), key=lambda item: (-item[1], item[0]))[:4]
    total = sum(weight for _, weight in best)
    if total <= 1e-12:
        return (0, 0, 0, 0), (1.0, 0.0, 0.0, 0.0)
    joints = [joint for joint, _ in best]
    weights = [weight / total for _, weight in best]
    while len(joints) < 4:
        joints.append(0)
        weights.append(0.0)
    return tuple(joints), tuple(weights)


def _average(a: tuple, b: tuple) -> tuple:
    return tuple((float(x) + float(y)) * 0.5 for x, y in zip(a, b))


def subdivide_once(attributes: dict[str, list[tuple]], indices: list[int]) -> tuple[dict[str, list[tuple]], list[int]]:
    out = {name: list(values) for name, values in attributes.items()}
    edge_mid: dict[tuple[int, int], int] = {}

    def midpoint(a: int, b: int) -> int:
        key = (a, b) if a < b else (b, a)
        cached = edge_mid.get(key)
        if cached is not None:
            return cached
        vertex = len(out["POSITION"])
        joints = weights = None
        if "JOINTS_0" in out and "WEIGHTS_0" in out:
            joints, weights = _midpoint_skin(
                out["JOINTS_0"][a], out["WEIGHTS_0"][a],
                out["JOINTS_0"][b], out["WEIGHTS_0"][b],
            )
        for semantic, values in out.items():
            if semantic == "JOINTS_0" and joints is not None:
                values.append(joints)
            elif semantic == "WEIGHTS_0" and weights is not None:
                values.append(weights)
            elif semantic == "NORMAL":
                values.append(_normalise(_average(values[a], values[b]), (0.0, 0.0, 1.0)))
            elif semantic == "TANGENT":
                avg = _average(values[a][:3], values[b][:3])
                xyz = _normalise(avg, (1.0, 0.0, 0.0))
                sign = 1.0 if float(values[a][3]) + float(values[b][3]) >= 0 else -1.0
                values.append((*xyz, sign))
            else:
                values.append(_average(values[a], values[b]))
        edge_mid[key] = vertex
        return vertex

    new_indices: list[int] = []
    for i in range(0, len(indices), 3):
        a, b, c = indices[i:i + 3]
        ab, bc, ca = midpoint(a, b), midpoint(b, c), midpoint(c, a)
        new_indices += [a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca]
    return out, new_indices


def _face_normal(a: tuple, b: tuple, c: tuple) -> tuple[float, float, float]:
    ab = (b[0]-a[0], b[1]-a[1], b[2]-a[2])
    ac = (c[0]-a[0], c[1]-a[1], c[2]-a[2])
    return _normalise((
        ab[1]*ac[2]-ab[2]*ac[1],
        ab[2]*ac[0]-ab[0]*ac[2],
        ab[0]*ac[1]-ab[1]*ac[0],
    ), (0.0, 0.0, 1.0))


def _adaptive_threshold(mode: str, pass_index: int) -> tuple[float, float]:
    base = {
        "high": (0.045, 0.16),
        "ultra": (0.032, 0.13),
        "modern": (0.026, 0.10),
        "experimental": (0.020, 0.08),
    }.get(mode, (0.05, 0.18))
    factor = 0.52 ** max(0, pass_index)
    return base[0] * factor, base[1]


def select_adaptive_edges(
    positions: list[tuple],
    indices: list[int],
    *,
    triangle_budget: int,
    mode: str,
    pass_index: int,
) -> set[tuple[int, int]]:
    triangle_count = len(indices) // 3
    available = max(0, triangle_budget - triangle_count)
    if available <= 0:
        return set()
    box = _bbox(positions)
    diagonal = max(_diag(box), 1e-9)
    face_normals = []
    edge_faces: dict[tuple[int, int], list[int]] = {}
    for face_index in range(triangle_count):
        a, b, c = indices[face_index*3:face_index*3+3]
        face_normals.append(_face_normal(positions[a], positions[b], positions[c]))
        for x, y in ((a,b),(b,c),(c,a)):
            edge = (x,y) if x < y else (y,x)
            edge_faces.setdefault(edge, []).append(face_index)

    min_length, min_curvature = _adaptive_threshold(mode, pass_index)
    candidates = []
    for edge, faces in edge_faces.items():
        a, b = edge
        length_ratio = math.dist(positions[a], positions[b]) / diagonal
        curvature = 0.0
        if len(faces) >= 2:
            n1, n2 = face_normals[faces[0]], face_normals[faces[1]]
            curvature = max(0.0, min(2.0, 1.0 - sum(n1[i]*n2[i] for i in range(3))))
        if length_ratio < min_length and curvature < min_curvature:
            continue
        # Length targets low-density areas; curvature prioritises silhouettes/creases.
        score = length_ratio + curvature * (0.55 if mode in {"modern","experimental"} else 0.40)
        candidates.append((score, edge, max(1, len(faces))))

    selected: set[tuple[int, int]] = set()
    for _, edge, cost in sorted(candidates, key=lambda row: (-row[0], row[1])):
        if cost > available:
            continue
        selected.add(edge)
        available -= cost
        if available <= 0:
            break
    return selected


def subdivide_selected_edges(
    attributes: dict[str, list[tuple]],
    indices: list[int],
    selected_edges: set[tuple[int, int]],
) -> tuple[dict[str, list[tuple]], list[int]]:
    if not selected_edges:
        return {name:list(values) for name,values in attributes.items()}, list(indices)
    out = {name: list(values) for name, values in attributes.items()}
    edge_mid: dict[tuple[int, int], int] = {}

    def midpoint(a: int, b: int) -> int:
        key = (a,b) if a < b else (b,a)
        cached = edge_mid.get(key)
        if cached is not None:
            return cached
        vertex = len(out["POSITION"])
        joints = weights = None
        if "JOINTS_0" in out and "WEIGHTS_0" in out:
            joints, weights = _midpoint_skin(
                out["JOINTS_0"][a], out["WEIGHTS_0"][a],
                out["JOINTS_0"][b], out["WEIGHTS_0"][b],
            )
        for semantic, values in out.items():
            if semantic == "JOINTS_0" and joints is not None:
                values.append(joints)
            elif semantic == "WEIGHTS_0" and weights is not None:
                values.append(weights)
            elif semantic == "NORMAL":
                values.append(_normalise(_average(values[a], values[b]), (0.0,0.0,1.0)))
            elif semantic == "TANGENT":
                xyz = _normalise(_average(values[a][:3], values[b][:3]), (1.0,0.0,0.0))
                sign = 1.0 if float(values[a][3]) + float(values[b][3]) >= 0 else -1.0
                values.append((*xyz,sign))
            else:
                values.append(_average(values[a], values[b]))
        edge_mid[key] = vertex
        return vertex

    def mid(a: int, b: int):
        key = (a,b) if a < b else (b,a)
        return midpoint(a,b) if key in selected_edges else None

    new_indices: list[int] = []
    for i in range(0,len(indices),3):
        a,b,c = indices[i:i+3]
        ab,bc,ca = mid(a,b),mid(b,c),mid(c,a)
        count = sum(v is not None for v in (ab,bc,ca))
        if count == 0:
            new_indices += [a,b,c]
        elif count == 1:
            if ab is not None:
                new_indices += [a,ab,c, ab,b,c]
            elif bc is not None:
                new_indices += [b,bc,a, bc,c,a]
            else:
                new_indices += [c,ca,b, ca,a,b]
        elif count == 2:
            if ca is None:
                new_indices += [b,bc,ab, a,ab,c, ab,bc,c]
            elif ab is None:
                new_indices += [c,ca,bc, b,bc,a, bc,ca,a]
            else:
                new_indices += [a,ab,ca, c,ca,b, ca,ab,b]
        else:
            new_indices += [a,ab,ca, ab,b,bc, ca,bc,c, ab,bc,ca]
    return out,new_indices


def split_crease_vertices(
    attributes: dict[str, list[tuple]],
    indices: list[int],
    crease_angle_degrees: float,
) -> tuple[dict[str, list[tuple]], list[int], int]:
    positions = attributes["POSITION"]
    original_count = len(positions)
    triangle_count = len(indices)//3
    face_normals = [
        _face_normal(
            positions[indices[i*3]],
            positions[indices[i*3+1]],
            positions[indices[i*3+2]],
        )
        for i in range(triangle_count)
    ]
    faces_by_vertex = [[] for _ in range(original_count)]
    for face in range(triangle_count):
        for corner in range(3):
            vertex = indices[face*3+corner]
            if vertex < original_count:
                faces_by_vertex[vertex].append(face)

    out = {name:list(values) for name,values in attributes.items()}
    new_indices = list(indices)
    threshold = math.cos(math.radians(crease_angle_degrees))
    split_count = 0
    for vertex, faces in enumerate(faces_by_vertex):
        if len(faces) <= 1:
            continue
        clusters: list[dict] = []
        for face in faces:
            normal = face_normals[face]
            chosen = None
            for cluster in clusters:
                reference = _normalise(cluster["sum"], normal)
                if sum(reference[i]*normal[i] for i in range(3)) >= threshold:
                    chosen = cluster
                    break
            if chosen is None:
                chosen = {"faces": [], "sum": [0.0,0.0,0.0]}
                clusters.append(chosen)
            chosen["faces"].append(face)
            for axis in range(3):
                chosen["sum"][axis] += normal[axis]
        for cluster_index, cluster in enumerate(clusters):
            if cluster_index == 0:
                replacement = vertex
            else:
                replacement = len(out["POSITION"])
                for values in out.values():
                    values.append(values[vertex])
                split_count += 1
            for face in cluster["faces"]:
                base = face*3
                for corner in range(3):
                    if new_indices[base+corner] == vertex:
                        new_indices[base+corner] = replacement
    return out,new_indices,split_count


def _corner_angle(origin: tuple, a: tuple, b: tuple) -> float:
    va = (a[0]-origin[0], a[1]-origin[1], a[2]-origin[2])
    vb = (b[0]-origin[0], b[1]-origin[1], b[2]-origin[2])
    na = _normalise(va, (1.0,0.0,0.0))
    nb = _normalise(vb, (1.0,0.0,0.0))
    dot = max(-1.0, min(1.0, sum(na[i]*nb[i] for i in range(3))))
    return math.acos(dot)


def recalc_normals(positions: list[tuple], indices: list[int]) -> list[tuple]:
    # Angle weighting keeps the shading stable when adaptive subdivision produces
    # different triangle sizes around the same vertex.
    sums = [[0.0, 0.0, 0.0] for _ in positions]
    for i in range(0, len(indices), 3):
        ia, ib, ic = indices[i:i + 3]
        a, b, c = positions[ia], positions[ib], positions[ic]
        normal = _face_normal(a,b,c)
        corners = (
            (ia,_corner_angle(a,b,c)),
            (ib,_corner_angle(b,c,a)),
            (ic,_corner_angle(c,a,b)),
        )
        for idx, weight in corners:
            for axis in range(3):
                sums[idx][axis] += normal[axis] * weight
    return [_normalise(row, (0.0, 0.0, 1.0)) for row in sums]


def recalc_tangents(positions, uvs, normals, indices) -> list[tuple]:
    tan1 = [[0.0, 0.0, 0.0] for _ in positions]
    tan2 = [[0.0, 0.0, 0.0] for _ in positions]
    for i in range(0, len(indices), 3):
        i1, i2, i3 = indices[i:i+3]
        v1, v2, v3 = positions[i1], positions[i2], positions[i3]
        w1, w2, w3 = uvs[i1], uvs[i2], uvs[i3]
        x1, x2 = v2[0]-v1[0], v3[0]-v1[0]
        y1, y2 = v2[1]-v1[1], v3[1]-v1[1]
        z1, z2 = v2[2]-v1[2], v3[2]-v1[2]
        s1, s2 = w2[0]-w1[0], w3[0]-w1[0]
        t1, t2 = w2[1]-w1[1], w3[1]-w1[1]
        denom = s1*t2 - s2*t1
        if abs(denom) < 1e-12:
            continue
        r = 1.0 / denom
        sdir = ((t2*x1-t1*x2)*r, (t2*y1-t1*y2)*r, (t2*z1-t1*z2)*r)
        tdir = ((s1*x2-s2*x1)*r, (s1*y2-s2*y1)*r, (s1*z2-s2*z1)*r)
        corner_weights = (
            (i1,_corner_angle(v1,v2,v3)),
            (i2,_corner_angle(v2,v3,v1)),
            (i3,_corner_angle(v3,v1,v2)),
        )
        for idx, weight in corner_weights:
            for axis in range(3):
                tan1[idx][axis] += sdir[axis] * weight
                tan2[idx][axis] += tdir[axis] * weight
    out = []
    for n, t, b in zip(normals, tan1, tan2):
        dot = sum(n[i]*t[i] for i in range(3))
        tangent = _normalise(tuple(t[i]-n[i]*dot for i in range(3)), (1.0, 0.0, 0.0))
        cross = (
            n[1]*tangent[2]-n[2]*tangent[1],
            n[2]*tangent[0]-n[0]*tangent[2],
            n[0]*tangent[1]-n[1]*tangent[0],
        )
        sign = -1.0 if sum(cross[i]*b[i] for i in range(3)) < 0 else 1.0
        out.append((*tangent, sign))
    return out


def _adjacency(indices: list[int], count: int):
    neighbours = [set() for _ in range(count)]
    edge_count: dict[tuple[int, int], int] = {}
    for i in range(0, len(indices), 3):
        tri = indices[i:i+3]
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            neighbours[a].add(b)
            neighbours[b].add(a)
            key = (a, b) if a < b else (b, a)
            edge_count[key] = edge_count.get(key, 0) + 1
    boundary = {v for edge, uses in edge_count.items() if uses == 1 for v in edge}
    return neighbours, boundary


def _crease_vertices(positions: list[tuple], indices: list[int], crease_angle_degrees: float) -> set[int]:
    face_normals = []
    edge_faces: dict[tuple[int,int], list[int]] = {}
    for face in range(len(indices)//3):
        a,b,c=indices[face*3:face*3+3]
        face_normals.append(_face_normal(positions[a],positions[b],positions[c]))
        for x,y in ((a,b),(b,c),(c,a)):
            edge=(x,y) if x<y else (y,x)
            edge_faces.setdefault(edge,[]).append(face)
    threshold=math.cos(math.radians(crease_angle_degrees))
    pinned=set()
    for (a,b),faces in edge_faces.items():
        if len(faces)!=2:
            continue
        n1,n2=face_normals[faces[0]],face_normals[faces[1]]
        if sum(n1[i]*n2[i] for i in range(3)) < threshold:
            pinned.add(a)
            pinned.add(b)
    return pinned


def relax_positions(
    positions: list[tuple],
    indices: list[int],
    strength: float,
    crease_angle_degrees: float = 55.0,
) -> tuple[list[tuple], float, float]:
    if strength <= 0:
        return list(positions), 0.0, 0.0
    neighbours, boundary = _adjacency(indices, len(positions))
    pinned = boundary | _crease_vertices(positions,indices,crease_angle_degrees)
    original = [tuple(map(float, p)) for p in positions]

    def step(current, factor):
        nxt = list(current)
        for i, p in enumerate(current):
            if i in pinned or not neighbours[i]:
                continue
            avg = tuple(sum(current[j][axis] for j in neighbours[i]) / len(neighbours[i]) for axis in range(3))
            nxt[i] = tuple(p[axis] + (avg[axis]-p[axis]) * factor for axis in range(3))
        return nxt

    current = step(original, strength)
    current = step(current, -strength * 1.03)
    distances = [
        math.dist(a, b) for a, b in zip(original, current)
    ]
    return current, (max(distances) if distances else 0.0), (sum(distances)/len(distances) if distances else 0.0)


def _bbox(points: list[tuple]):
    if not points:
        return ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0))
    return (
        tuple(min(p[i] for p in points) for i in range(3)),
        tuple(max(p[i] for p in points) for i in range(3)),
    )


def _diag(box) -> float:
    return math.dist(box[0], box[1])


def enhance_gltf(path: Path, *, mode: str = "high", options: dict | None = None) -> dict:
    options = options or {}
    doc = json.loads(path.read_text(encoding="utf-8"))
    buffers = doc.get("buffers") or []
    if len(buffers) != 1:
        return {"file": str(path), "changed": False, "reason": "requires exactly one local buffer", "primitives": []}
    uri = buffers[0].get("uri")
    if not isinstance(uri, str) or uri.startswith("data:") or "/" in uri or "\\" in uri:
        return {"file": str(path), "changed": False, "reason": "requires a local sibling .bin buffer", "primitives": []}
    bin_path = path.parent / uri
    if not bin_path.is_file():
        return {"file": str(path), "changed": False, "reason": f"missing buffer {uri}", "primitives": []}

    blob = bytearray(bin_path.read_bytes())
    kind = _kind(path)
    profile = geometry_profile(mode, kind, options)
    primitive_rows = []
    changed = False

    for mesh_index, mesh in enumerate(doc.get("meshes", [])):
        for primitive_index, primitive in enumerate(mesh.get("primitives", [])):
            row = {"mesh": mesh_index, "primitive": primitive_index, "kind": kind}
            attrs = primitive.get("attributes") or {}
            unsupported = sorted(set(attrs) - _SUPPORTED)
            if unsupported:
                row.update(changed=False, reason=f"unsupported attributes: {', '.join(unsupported)}")
                primitive_rows.append(row)
                continue
            if primitive.get("targets"):
                row.update(changed=False, reason="morph targets are left untouched in v1")
                primitive_rows.append(row)
                continue
            if int(primitive.get("mode", 4)) != 4 or "POSITION" not in attrs or "TEXCOORD_0" not in attrs:
                row.update(changed=False, reason="requires indexed/implicit TRIANGLES with POSITION and TEXCOORD_0")
                primitive_rows.append(row)
                continue
            try:
                data = {semantic: read_accessor(doc, blob, int(accessor)) for semantic, accessor in attrs.items()}
                vertex_count = len(data["POSITION"])
                if any(len(values) != vertex_count for values in data.values()):
                    raise ValueError("attribute vertex counts differ")
                if ("JOINTS_0" in data) != ("WEIGHTS_0" in data):
                    raise ValueError("JOINTS_0 and WEIGHTS_0 must appear together")
                if "indices" in primitive:
                    raw_indices = read_accessor(doc, blob, int(primitive["indices"]))
                    indices = [int(v[0]) for v in raw_indices]
                else:
                    indices = list(range(vertex_count))
                if len(indices) % 3:
                    raise ValueError("triangle index count is not divisible by three")
                if not indices or max(indices) >= vertex_count or min(indices) < 0:
                    raise ValueError("indices are out of bounds")
            except Exception as exc:
                row.update(changed=False, reason=str(exc))
                primitive_rows.append(row)
                continue

            before_positions = [tuple(map(float, p[:3])) for p in data["POSITION"]]
            data["POSITION"] = before_positions
            before_box = _bbox(before_positions)
            triangles_before = len(indices) // 3
            requested = profile.subdivisions
            applied = 0
            budget_limited = False
            adaptive_edges_split = 0
            for pass_index in range(requested):
                if profile.adaptive_subdivision:
                    selected = select_adaptive_edges(
                        data["POSITION"], indices,
                        triangle_budget=profile.triangle_budget,
                        mode=profile.mode,
                        pass_index=pass_index,
                    )
                    if not selected:
                        if len(indices)//3 >= profile.triangle_budget:
                            budget_limited = True
                        break
                    adaptive_edges_split += len(selected)
                    data, indices = subdivide_selected_edges(data, indices, selected)
                    applied += 1
                else:
                    if (len(indices) // 3) * 4 > profile.triangle_budget:
                        budget_limited = True
                        break
                    data, indices = subdivide_once(data, indices)
                    applied += 1

            moved_max = moved_mean = 0.0
            if profile.shape_relax > 0:
                relaxed, moved_max, moved_mean = relax_positions(
                    data["POSITION"], indices, profile.shape_relax, profile.crease_angle_degrees
                )
                data["POSITION"] = relaxed

            crease_vertices_split = 0
            if profile.recalc_normals:
                data, indices, crease_vertices_split = split_crease_vertices(
                    data, indices, profile.crease_angle_degrees
                )
                data["NORMAL"] = recalc_normals(data["POSITION"], indices)
            if profile.recalc_tangents and "TANGENT" in data:
                data["TANGENT"] = recalc_tangents(
                    data["POSITION"], data["TEXCOORD_0"], data["NORMAL"], indices
                )

            new_attrs = {}
            for semantic, values in data.items():
                if semantic == "JOINTS_0":
                    accessor = _append_accessor(doc, blob, values, component=5123, type_name="VEC4", target=34962)
                else:
                    width = len(values[0]) if values else 3
                    type_name = {1:"SCALAR",2:"VEC2",3:"VEC3",4:"VEC4"}[width]
                    accessor = _append_accessor(
                        doc, blob, values, component=5126, type_name=type_name, target=34962,
                        include_bounds=semantic=="POSITION",
                    )
                new_attrs[semantic] = accessor
            index_accessor = _append_accessor(
                doc, blob, [(i,) for i in indices],
                component=5125, type_name="SCALAR", target=34963,
            )
            primitive["attributes"] = new_attrs
            primitive["indices"] = index_accessor
            changed = True

            after_box = _bbox(data["POSITION"])
            scale = max(_diag(before_box), 1e-9)
            bbox_shift = max(
                *(abs(after_box[0][i]-before_box[0][i]) for i in range(3)),
                *(abs(after_box[1][i]-before_box[1][i]) for i in range(3)),
            ) / scale
            collision_warning = moved_max > scale * 0.002
            row.update(
                changed=True,
                vertices_before=vertex_count,
                vertices_after=len(data["POSITION"]),
                triangles_before=triangles_before,
                triangles_after=len(indices)//3,
                subdivisions_requested=requested,
                subdivisions_applied=applied,
                budget_limited=budget_limited,
                triangle_budget=profile.triangle_budget,
                adaptive_subdivision=profile.adaptive_subdivision,
                adaptive_edges_split=adaptive_edges_split,
                crease_angle_degrees=profile.crease_angle_degrees,
                crease_vertices_split=crease_vertices_split,
                shape_refine=profile.shape_relax > 0,
                max_vertex_move=moved_max,
                mean_vertex_move=moved_mean,
                bbox_relative_shift=bbox_shift,
                collision_rebuild_recommended=collision_warning,
            )
            primitive_rows.append(row)

    if changed:
        doc["buffers"][0]["byteLength"] = len(blob)
        bin_path.write_bytes(blob)
        path.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    return {
        "file": str(path),
        "kind": kind,
        "mode": mode,
        "changed": changed,
        "profile": {
            "subdivisions": profile.subdivisions,
            "triangle_budget": profile.triangle_budget,
            "shape_relax": profile.shape_relax,
            "adaptive_subdivision": profile.adaptive_subdivision,
            "crease_angle_degrees": profile.crease_angle_degrees,
        },
        "primitives": primitive_rows,
    }


def enhance_export(export_dir: Path, *, mode: str = "high", options: dict | None = None) -> dict:
    rows = []
    for path in sorted(export_dir.rglob("*.gltf")):
        if "/sky/" in path.as_posix():
            continue
        rows.append(enhance_gltf(path, mode=mode, options=options))
    changed = [row for row in rows if row.get("changed")]
    primitive_rows = [p for row in rows for p in row.get("primitives", [])]
    before = sum(int(p.get("triangles_before", 0)) for p in primitive_rows if p.get("changed"))
    after = sum(int(p.get("triangles_after", 0)) for p in primitive_rows if p.get("changed"))
    collision = [
        {"file": row["file"], "mesh": p["mesh"], "primitive": p["primitive"]}
        for row in rows for p in row.get("primitives", [])
        if p.get("collision_rebuild_recommended")
    ]
    return {
        "format": 1,
        "mode": mode,
        "files_seen": len(rows),
        "files_changed": len(changed),
        "triangles_before": before,
        "triangles_after": after,
        "triangle_multiplier": (after / before if before else 1.0),
        "collision_rebuild_recommended": collision,
        "files": rows,
    }

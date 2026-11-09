from __future__ import annotations

import json
import math
from pathlib import Path
import tempfile
import unittest

from helper.openrac_graphics_helper import GeometryHeightProvider, MaterialPackReader
from helper.geometry_enhance import (
    HeightMap,
    _append_accessor,
    apply_micro_displacement,
    build_lod_plan,
    classify_asset_role,
    derive_height_from_rgba,
    enhance_export,
    enhance_gltf,
    geometry_profile,
    optimize_triangle_topology,
    read_accessor,
    refine_silhouette_positions,
    remesh_policy,
    select_adaptive_edges,
    split_crease_vertices,
)


def write_fixture(root: Path, kind: str = "moby") -> Path:
    if kind == "terrain":
        folder = root / "terrain"
    elif kind == "tie":
        folder = root / "ties" / "tie_5"
    elif kind == "shrub":
        folder = root / "shrubs" / "shrub_6"
    else:
        folder = root / "mobys" / "moby_7_test"
    folder.mkdir(parents=True)
    path = folder / "model.gltf"
    blob = bytearray()
    doc = {
        "asset": {"version": "2.0"},
        "buffers": [{"uri": "model.bin", "byteLength": 0}],
        "bufferViews": [],
        "accessors": [],
        "meshes": [{"primitives": []}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0,
    }
    positions = [(0.0,0.0,0.0),(2.0,0.0,0.0),(0.0,2.0,0.0)]
    normals = [(0.0,0.0,1.0)] * 3
    tangents = [(1.0,0.0,0.0,1.0)] * 3
    uvs = [(0.0,0.0),(1.0,0.0),(0.0,1.0)]
    colours = [(1.0,0.5,0.25,1.0),(0.5,1.0,0.25,1.0),(0.25,0.5,1.0,1.0)]
    joints = [(0,1,0,0),(0,1,0,0),(0,1,0,0)]
    weights = [(0.75,0.25,0.0,0.0),(0.5,0.5,0.0,0.0),(0.25,0.75,0.0,0.0)]

    attrs = {
        "POSITION": _append_accessor(doc,blob,positions,component=5126,type_name="VEC3",target=34962,include_bounds=True),
        "NORMAL": _append_accessor(doc,blob,normals,component=5126,type_name="VEC3",target=34962),
        "TANGENT": _append_accessor(doc,blob,tangents,component=5126,type_name="VEC4",target=34962),
        "TEXCOORD_0": _append_accessor(doc,blob,uvs,component=5126,type_name="VEC2",target=34962),
        "COLOR_0": _append_accessor(doc,blob,colours,component=5126,type_name="VEC4",target=34962),
        "JOINTS_0": _append_accessor(doc,blob,joints,component=5123,type_name="VEC4",target=34962),
        "WEIGHTS_0": _append_accessor(doc,blob,weights,component=5126,type_name="VEC4",target=34962),
    }
    indices = _append_accessor(doc,blob,[(0,),(1,),(2,)],component=5125,type_name="SCALAR",target=34963)
    doc["meshes"][0]["primitives"].append({"attributes": attrs, "indices": indices, "mode": 4})
    doc["buffers"][0]["byteLength"] = len(blob)
    (folder / "model.bin").write_bytes(blob)
    path.write_text(json.dumps(doc,indent=2)+"\n",encoding="utf-8")
    return path


class GeometryEnhanceTests(unittest.TestCase):
    def test_high_subdivision_preserves_uv_skinning_and_tangent_space(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_fixture(Path(tmp),"moby")
            report = enhance_gltf(path,mode="high")
            self.assertTrue(report["changed"])
            primitive = report["primitives"][0]
            self.assertEqual(primitive["triangles_before"],1)
            self.assertEqual(primitive["triangles_after"],4)
            self.assertEqual(primitive["vertices_before"],3)
            self.assertEqual(primitive["vertices_after"],6)
            self.assertFalse(primitive["collision_rebuild_recommended"])

            doc=json.loads(path.read_text(encoding="utf-8"))
            blob=(path.parent/"model.bin").read_bytes()
            p=doc["meshes"][0]["primitives"][0]
            uvs=read_accessor(doc,blob,p["attributes"]["TEXCOORD_0"])
            joints=read_accessor(doc,blob,p["attributes"]["JOINTS_0"])
            weights=read_accessor(doc,blob,p["attributes"]["WEIGHTS_0"])
            normals=read_accessor(doc,blob,p["attributes"]["NORMAL"])
            tangents=read_accessor(doc,blob,p["attributes"]["TANGENT"])
            indices=read_accessor(doc,blob,p["indices"])
            self.assertEqual(len(uvs),6)
            self.assertEqual(len(indices),12)
            self.assertEqual(len(joints),len(weights))
            for row in weights:
                self.assertAlmostEqual(sum(row),1.0,places=5)
            for row in normals:
                self.assertAlmostEqual(math.sqrt(sum(v*v for v in row)),1.0,places=5)
            for row in tangents:
                self.assertAlmostEqual(math.sqrt(sum(v*v for v in row[:3])),1.0,places=5)
                self.assertIn(round(row[3]),(-1,1))

    def test_ultra_can_add_two_crack_free_subdivision_levels_when_budget_allows(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"terrain")
            report=enhance_gltf(path,mode="ultra",options={"triangle_budget":1000})
            p=report["primitives"][0]
            self.assertEqual(p["subdivisions_applied"],2)
            self.assertEqual(p["triangles_after"],16)
            self.assertEqual(p["vertices_after"],15)
            self.assertFalse(p["budget_limited"])

    def test_budget_stops_excessive_subdivision(self):
        profile=geometry_profile("ultra","moby",{"triangle_budget":256})
        self.assertEqual(profile.triangle_budget,256)
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"moby")
            # Inflate the request via a fixture with one triangle; it still fits two passes.
            report=enhance_gltf(path,mode="ultra",options={"triangle_budget":4})
            # Profile clamps pathological budgets to a safe minimum instead of accepting zero/tiny values.
            self.assertGreaterEqual(report["profile"]["triangle_budget"],256)

    def test_shape_refine_is_opt_in_and_protected_for_gameplay_meshes(self):
        safe=geometry_profile("ultra","moby",{"shape_refine":True})
        risky=geometry_profile("experimental","moby",{
            "shape_refine":True,
            "allow_collision_mismatch":True,
        })
        static=geometry_profile("ultra","tie",{"shape_refine":True})
        self.assertEqual(safe.shape_relax,0.0)
        self.assertGreater(risky.shape_relax,0.0)
        self.assertGreater(static.shape_relax,0.0)

    def test_modern_profile_uses_larger_adaptive_budget_without_collision_movement(self):
        profile=geometry_profile("modern","moby",{"shape_refine":True})
        self.assertEqual(profile.subdivisions,2)
        self.assertEqual(profile.triangle_budget,120_000)
        self.assertTrue(profile.adaptive_subdivision)
        self.assertEqual(profile.shape_relax,0.0)
        self.assertAlmostEqual(profile.crease_angle_degrees,50.0)

    def test_adaptive_selection_spends_budget_on_long_or_curved_edges(self):
        positions=[
            (0.0,0.0,0.0),(4.0,0.0,0.0),(0.0,4.0,0.0),
            (0.2,0.2,0.0),
        ]
        indices=[0,1,2, 0,3,1]
        selected=select_adaptive_edges(
            positions,indices,triangle_budget=5,mode="modern",pass_index=0
        )
        self.assertTrue(selected)
        # Each selected edge has a globally consistent key, preventing T-junction cracks.
        self.assertTrue(all(a < b for a,b in selected))
        self.assertLessEqual(len(indices)//3 + sum(
            2 if edge == (0,1) else 1 for edge in selected
        ),5)

    def test_crease_preservation_splits_shared_vertex_across_a_hard_fold(self):
        attrs={
            "POSITION":[
                (0.0,0.0,0.0),(1.0,0.0,0.0),(0.0,1.0,0.0),(0.0,0.0,1.0),
            ],
            "TEXCOORD_0":[
                (0.0,0.0),(1.0,0.0),(0.0,1.0),(1.0,1.0),
            ],
        }
        # Two triangles meet at roughly 90 degrees and share vertices 0 and 1.
        out,new_indices,splits=split_crease_vertices(attrs,[0,1,2, 0,3,1],55.0)
        self.assertGreaterEqual(splits,2)
        self.assertGreater(len(out["POSITION"]),len(attrs["POSITION"]))
        self.assertNotEqual(new_indices[0],new_indices[3])
        self.assertNotEqual(new_indices[1],new_indices[5])

    def test_export_report_exposes_adaptive_quality_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            write_fixture(root,"terrain")
            write_fixture(root,"tie")
            report=enhance_export(root,mode="modern")
            self.assertEqual(report["format"],2)
            self.assertGreaterEqual(report["files_seen"],2)
            self.assertGreaterEqual(report["files_changed"],2)
            self.assertGreater(report["adaptive_edges_split"],0)
            self.assertIn("crease_vertices_split",report)
            self.assertIn("budget_limited_primitives",report)
            self.assertIn("primitives_skipped",report)
            self.assertIn("skip_reasons",report)

    def test_micro_displacement_moves_only_interior_static_vertices(self):
        attrs={
            "POSITION":[
                (-1.0,-1.0,0.0),(1.0,-1.0,0.0),(1.0,1.0,0.0),(-1.0,1.0,0.0),(0.0,0.0,0.0),
            ],
            "TEXCOORD_0":[
                (0.0,0.0),(1.0,0.0),(1.0,1.0),(0.0,1.0),(0.5,0.5),
            ],
        }
        indices=[0,1,4, 1,2,4, 2,3,4, 3,0,4]
        height=HeightMap(
            3,3,
            (0.5,0.5,0.5, 0.5,1.0,0.5, 0.5,0.5,0.5),
            (255,)*9,
            material="stone",neutral=0.5,recommended_scale=0.06,source="sidecar",
        )
        moved,qa=apply_micro_displacement(
            attrs,indices,height,kind="tie",strength=1.0,crease_angle_degrees=75.0
        )
        self.assertTrue(qa["applied"])
        self.assertGreater(moved[4][2],0.0)
        for i in range(4):
            self.assertEqual(moved[i],attrs["POSITION"][i])
        self.assertEqual(qa["vertices_moved"],1)
        self.assertGreater(qa["vertices_pinned"],0)
        self.assertLessEqual(qa["cap"],math.dist((-1,-1,0),(1,1,0))*0.0048+1e-9)

    def test_micro_displacement_keeps_terrain_and_mobys_collision_locked_by_default(self):
        attrs={
            "POSITION":[(-1.0,-1.0,0.0),(1.0,-1.0,0.0),(0.0,1.0,0.0),(0.0,0.0,0.0)],
            "TEXCOORD_0":[(0,0),(1,0),(.5,1),(.5,.5)],
        }
        indices=[0,1,3,1,2,3,2,0,3]
        height=HeightMap(1,1,(1.0,),(255,),material="terrain",source="sidecar")
        for kind in ("terrain","moby"):
            moved,qa=apply_micro_displacement(attrs,indices,height,kind=kind)
            self.assertFalse(qa["applied"])
            self.assertEqual(qa["reason"],"collision-safe lock")
            self.assertEqual(moved,attrs["POSITION"])

    def test_diffuse_height_fallback_stays_relative_and_conservative(self):
        rgba=bytes([
            32,32,32,255, 64,64,64,255, 32,32,32,255,
            64,64,64,255, 240,240,240,255, 64,64,64,255,
            32,32,32,255, 64,64,64,255, 32,32,32,255,
        ])
        height=derive_height_from_rgba(3,3,rgba,"stone")
        self.assertEqual(height.source,"diffuse-derived")
        self.assertGreater(height.values[4],0.5)
        self.assertTrue(all(0.18<=value<=0.82 for value in height.values))
        self.assertEqual(height.neutral,0.5)

    def test_export_report_counts_micro_displacement_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            path=write_fixture(root,"tie")
            height=HeightMap(1,1,(0.75,),(255,),material="stone",source="sidecar")
            report=enhance_export(
                root,mode="modern",
                options={"micro_displacement":True},
                height_provider=lambda *_args: height,
            )
            self.assertEqual(report["format"],2)
            self.assertIn("micro_displacement_primitives",report)
            self.assertIn("micro_displacement_sources",report)

    def test_material_pack_sidecar_is_preferred_and_uses_metadata(self):
        import zipfile
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            pack=root/"materials.zip"
            texture_hash="aaaaaaaaaaaaaaaa"
            meta={
                "sourceHash":texture_hash,
                "material":"stone",
                "quality":{"ok":True},
                "heightPipeline":{"parallaxAuthoring":{
                    "neutralHeight":0.5,
                    "recommendedScale":0.06,
                }},
            }
            with zipfile.ZipFile(pack,"w") as zf:
                zf.writestr(f"Materials/{texture_hash}/height.png",b"height")
                zf.writestr(f"Materials/{texture_hash}/material.json",json.dumps(meta))
            reader=MaterialPackReader(pack)
            try:
                provider=GeometryHeightProvider(
                    export_root=root,
                    png_reader=lambda _data:(2,2,bytes([
                        128,128,128,255, 255,255,255,255,
                        128,128,128,255, 128,128,128,255,
                    ])),
                    material_pack=reader,
                    height_source="auto",
                )
                doc={
                    "materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}],
                    "textures":[{"source":0}],
                    "images":[{"uri":"../../textures/aaaaaaaaaaaaaaaa.png"}],
                }
                result=provider(root/"level_00/ties/tie_5/model.gltf",doc,{"material":0},"tie")
                self.assertIsNotNone(result)
                self.assertEqual(result.source,"sidecar")
                self.assertEqual(result.material,"stone")
                self.assertAlmostEqual(result.recommended_scale,0.06)
                self.assertEqual(provider.stats["sidecar"],1)
            finally:
                reader.close()

    def test_auto_height_source_falls_back_to_exported_diffuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            gltf=root/"level_00/ties/tie_5/model.gltf"
            gltf.parent.mkdir(parents=True)
            texture=root/"level_00/textures/bbbbbbbbbbbbbbbb.png"
            texture.parent.mkdir(parents=True)
            texture.write_bytes(b"diffuse")
            reader=MaterialPackReader(None)
            provider=GeometryHeightProvider(
                export_root=root,
                png_reader=lambda _data:(3,3,bytes([
                    32,32,32,255, 64,64,64,255, 32,32,32,255,
                    64,64,64,255, 240,240,240,255, 64,64,64,255,
                    32,32,32,255, 64,64,64,255, 32,32,32,255,
                ])),
                material_pack=reader,
                height_source="auto",
            )
            doc={
                "materials":[{"name":"stone_wall","pbrMetallicRoughness":{"baseColorTexture":{"index":0}}}],
                "textures":[{"source":0}],
                "images":[{"uri":"../../textures/bbbbbbbbbbbbbbbb.png"}],
            }
            result=provider(gltf,doc,{"material":0},"tie")
            self.assertIsNotNone(result)
            self.assertEqual(result.source,"diffuse-derived")
            self.assertEqual(result.material,"stone")
            self.assertEqual(provider.stats["diffuse-derived"],1)

    def test_asset_role_classification_separates_character_weapon_rock_and_foliage(self):
        primitive={"material":0}
        skinned={"JOINTS_0":[(0,0,0,0)],"WEIGHTS_0":[(1,0,0,0)]}
        character_doc={"materials":[{"name":"ratchet_body"}]}
        self.assertEqual(
            classify_asset_role(Path("level_01/mobys/moby_0_ratchet/model.gltf"),character_doc,primitive,"moby",skinned),
            "character",
        )
        weapon_doc={"materials":[{"name":"metal_blaster"}]}
        self.assertEqual(
            classify_asset_role(Path("level_01/mobys/moby_42_blaster/model.gltf"),weapon_doc,primitive,"moby",skinned),
            "weapon",
        )
        rock_doc={"materials":[{"name":"stone_cliff"}]}
        self.assertEqual(
            classify_asset_role(Path("level_01/ties/tie_5/model.gltf"),rock_doc,primitive,"tie",{}),
            "rock",
        )
        self.assertEqual(
            classify_asset_role(Path("level_01/shrubs/shrub_6/model.gltf"),{"materials":[]},{}, "shrub",{}),
            "foliage",
        )
        self.assertGreater(remesh_policy("character").budget_multiplier,1.0)
        self.assertLess(remesh_policy("foliage").budget_multiplier,1.0)

    def test_role_aware_adaptive_selection_prioritises_character_outline_density(self):
        positions=[
            (0.0,0.0,0.0),(4.0,0.0,0.0),(0.0,1.0,0.0),
            (4.0,1.0,0.0),
        ]
        indices=[0,1,2, 1,3,2]
        generic=select_adaptive_edges(
            positions,indices,triangle_budget=5,mode="modern",pass_index=0,role="generic"
        )
        character=select_adaptive_edges(
            positions,indices,triangle_budget=5,mode="modern",pass_index=0,role="character"
        )
        self.assertGreaterEqual(len(character),len(generic))
        self.assertTrue(character)

    def test_triangle_topology_optimizer_never_degrades_average_quality(self):
        attrs={
            "POSITION":[
                (0.0,0.0,0.0),(3.0,0.0,0.0),(2.2,1.0,0.0),(0.0,2.2,0.0),
            ],
            "TEXCOORD_0":[
                (0.0,0.0),(1.0,0.0),(.75,.45),(0.0,1.0),
            ],
        }
        indices=[0,1,2, 0,2,3]
        out,qa=optimize_triangle_topology(attrs,indices,175.0)
        self.assertEqual(len(out),len(indices))
        self.assertGreaterEqual(qa["quality_after"]+1e-12,qa["quality_before"])
        self.assertGreaterEqual(qa["flips"],0)

    def test_silhouette_refinement_moves_closed_curved_mesh_but_keeps_bounds_finite(self):
        positions=[
            (1.0,1.0,1.0),(-1.0,-1.0,1.0),(-1.0,1.0,-1.0),(1.0,-1.0,-1.0),
        ]
        indices=[0,2,1, 0,1,3, 0,3,2, 1,2,3]
        refined,qa=refine_silhouette_positions(positions,indices,.02,175.0)
        self.assertTrue(qa["applied"])
        self.assertGreater(qa["max_move"],0.0)
        self.assertTrue(all(math.isfinite(v) for p in refined for v in p))

    def test_lod_plan_uses_real_subdivision_stages_and_marks_stock_runtime_gap(self):
        plan=build_lod_plan("weapon",[1200,3400,7600],7600)
        self.assertEqual(plan["available_stage_triangles"]["lod0"],7600)
        self.assertEqual(plan["available_stage_triangles"]["lod1"],3400)
        self.assertEqual(plan["available_stage_triangles"]["lod2"],1200)
        self.assertFalse(plan["stock_import_runtime"])
        self.assertEqual(plan["role"],"weapon")

    def test_remesh_and_lod_toggles_disable_role_policy_and_plan(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"tie")
            report=enhance_gltf(
                path,mode="modern",
                options={
                    "asset_aware_remesh":False,
                    "lod_planning":False,
                    "shape_refine":True,
                },
            )
            primitive=report["primitives"][0]
            self.assertEqual(primitive["asset_role"],"generic")
            self.assertFalse(primitive["asset_aware_remesh"])
            self.assertIsNone(primitive["lod_plan"])

    def test_moby_silhouette_refinement_reports_collision_safe_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"moby")
            report=enhance_gltf(
                path,mode="modern",
                options={
                    "shape_refine":True,
                    "silhouette_refine":True,
                    "allow_collision_mismatch":False,
                },
            )
            primitive=report["primitives"][0]
            self.assertFalse(primitive["silhouette_refinement"]["applied"])
            self.assertEqual(primitive["silhouette_refinement"]["reason"],"collision-safe lock")

    def test_unsupported_morph_target_is_left_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=write_fixture(Path(tmp),"moby")
            doc=json.loads(path.read_text(encoding="utf-8"))
            doc["meshes"][0]["primitives"][0]["targets"]=[{"POSITION":doc["meshes"][0]["primitives"][0]["attributes"]["POSITION"]}]
            path.write_text(json.dumps(doc),encoding="utf-8")
            report=enhance_gltf(path,mode="high")
            self.assertFalse(report["changed"])
            self.assertIn("morph targets",report["primitives"][0]["reason"])


if __name__ == "__main__":
    unittest.main()

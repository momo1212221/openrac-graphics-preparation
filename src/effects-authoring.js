// SPDX-License-Identifier: GPL-3.0-or-later
import {ZipStream} from "./zip.js";

const encoder = new TextEncoder();
const dec = new TextDecoder();

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const vec3 = (value, fallback) => Array.from({length:3}, (_,i)=>safeNumber(value?.[i], fallback[i]));
const clone = (value) => JSON.parse(JSON.stringify(value));

export const DEFAULT_EFFECTS = {
  selectedLevel: "",
  selectedObject: "",
  baker: {
    skyIntensity: 0.5,
    skyWeight: 0.3,
    surfaceEmissionScale: 1,
    environmentProbes: true,
    probeResolution: 64,
    maximumProbes: 512,
    spacing: 24,
  },
  lights: [],
  areaLights: [],
  particles: [],
};

export function normalizeEffects(value) {
  const src = value && typeof value === "object" ? value : {};
  return {
    selectedLevel: typeof src.selectedLevel === "string" ? src.selectedLevel : "",
    selectedObject: typeof src.selectedObject === "string" ? src.selectedObject : "",
    baker: {
      skyIntensity: safeNumber(src.baker?.skyIntensity, 0.5),
      skyWeight: safeNumber(src.baker?.skyWeight, 0.3),
      surfaceEmissionScale: safeNumber(src.baker?.surfaceEmissionScale, 1),
      environmentProbes: src.baker?.environmentProbes !== false,
      probeResolution: Math.max(16, Math.round(safeNumber(src.baker?.probeResolution, 64))),
      maximumProbes: Math.max(16, Math.round(safeNumber(src.baker?.maximumProbes, 512))),
      spacing: Math.max(1, safeNumber(src.baker?.spacing, 24)),
    },
    lights: Array.isArray(src.lights) ? src.lights.map(normalizeLight) : [],
    areaLights: Array.isArray(src.areaLights) ? src.areaLights.map(normalizeAreaLight) : [],
    particles: Array.isArray(src.particles) ? src.particles.map(normalizeParticle) : [],
  };
}

export function normalizeLight(value = {}) {
  const type = value.type === "spot" ? "spot" : "point";
  return {
    object: String(value.object || ""),
    name: String(value.name || "Light").slice(0,128),
    bone: String(value.bone || "").slice(0,128),
    type,
    enabled: value.enabled !== false,
    position: vec3(value.position,[0,0,0]),
    direction: vec3(value.direction,[0,0,-1]),
    colour: vec3(value.colour,[1,0.8,0.45]).map(v=>Math.max(0,v)),
    intensity: Math.max(0,safeNumber(value.intensity,4)),
    range: Math.max(0,safeNumber(value.range,12)),
    inner_angle: Math.max(0,Math.min(1.55,safeNumber(value.inner_angle,0.25))),
    outer_angle: Math.max(0,Math.min(1.56,safeNumber(value.outer_angle,0.55))),
  };
}

export function normalizeAreaLight(value = {}) {
  return {
    level: String(value.level || ""),
    position: vec3(value.position,[0,0,0]),
    axis_u: vec3(value.axis_u,[2,0,0]),
    axis_v: vec3(value.axis_v,[0,2,0]),
    radiance: vec3(value.radiance,[8,6,3]).map(v=>Math.max(0,v)),
  };
}

export function normalizeParticle(value = {}) {
  const presets = ["sparks","smoke","mist","glow","energy","rain","heat-haze"];
  return {
    level: String(value.level || ""),
    preset: presets.includes(value.preset) ? value.preset : "sparks",
    position: vec3(value.position,[0,0,0]),
    colour: vec3(value.colour,[1,0.55,0.15]).map(v=>Math.max(0,Math.min(4,v))),
    alpha: Math.max(0,Math.min(1,safeNumber(value.alpha,0.9))),
    rate: Math.max(0,Math.min(120,safeNumber(value.rate,12))),
    life: Math.max(0.05,Math.min(20,safeNumber(value.life,1.2))),
    size: Math.max(0.01,Math.min(50,safeNumber(value.size,0.18))),
    speed: Math.max(0,Math.min(100,safeNumber(value.speed,4))),
    spread: Math.max(0,Math.min(20,safeNumber(value.spread,1.5))),
    gravity: Math.max(-100,Math.min(100,safeNumber(value.gravity,-4))),
    hazeRadius: Math.max(0,Math.min(100,safeNumber(value.hazeRadius,3))),
    hazeStrength: Math.max(0,Math.min(10,safeNumber(value.hazeStrength,0.35))),
  };
}

const stem = (path) => String(path || "").replace(/\.glb$/i,"");

function objectsFromManifest(manifest) {
  const out = [];
  const classes = manifest?.classes || {};
  for (const [layer, rows] of Object.entries(classes)) {
    if (!rows || typeof rows !== "object") continue;
    for (const [id, entry] of Object.entries(rows)) {
      if (!entry || typeof entry.mesh !== "string" || !entry.mesh) continue;
      const key = stem(entry.mesh);
      if (!key) continue;
      out.push({
        key,
        layer,
        classId:id,
        name:entry.name || key.split("/").pop() || key,
        label:`${layer} ${id} · ${entry.name || key.split("/").pop() || key}`,
      });
    }
  }
  const seen = new Set();
  return out.filter((row)=>!seen.has(row.key) && seen.add(row.key)).sort((a,b)=>a.label.localeCompare(b.label));
}

export async function loadLevels(controller) {
  const files = await controller.list("levels");
  const manifests = (files || []).filter((f)=>/^level_\d+\/manifest\.json$/.test(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
  const out = [];
  for (const file of manifests) {
    try {
      const raw = await controller.read("levels", file.path);
      const manifest = JSON.parse(dec.decode(raw));
      const dir = file.path.split("/")[0];
      out.push({
        dir,
        level:Number.isInteger(manifest.level) ? manifest.level : Number(dir.replace("level_","")),
        manifest,
        objects:objectsFromManifest(manifest),
      });
    } catch {
      // A broken level should not make authoring disappear for every other exported level.
    }
  }
  return out;
}

export async function readProbeProfile(controller, levelDir) {
  if (!levelDir) return {};
  try {
    const raw = await controller.read("levels", `${levelDir}/probe-bake.json`);
    const value = JSON.parse(dec.decode(raw));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function objectLightCatalog(state) {
  const objects = {};
  for (const raw of state.lights) {
    const light = normalizeLight(raw);
    if (!light.object) continue;
    (objects[light.object] ||= []).push({
      name:light.name,
      type:light.type,
      bone:light.bone,
      enabled:light.enabled,
      position:light.position,
      direction:light.direction,
      colour:light.colour,
      intensity:light.intensity,
      range:light.range,
      inner_angle:Math.min(light.inner_angle,light.outer_angle),
      outer_angle:Math.max(light.inner_angle,light.outer_angle),
    });
  }
  return {version:1,objects};
}

export function bakerProfile(baseProfile, state, levelDir) {
  const profile = clone(baseProfile && typeof baseProfile === "object" ? baseProfile : {});
  profile.version = Number.isInteger(profile.version) ? profile.version : 1;
  profile.sky_intensity = state.baker.skyIntensity;
  profile.sky_weight = state.baker.skyWeight;
  profile.surface_emission_scale = state.baker.surfaceEmissionScale;
  profile.environment_probes = {
    ...(profile.environment_probes && typeof profile.environment_probes === "object" ? profile.environment_probes : {}),
    enabled:state.baker.environmentProbes,
    resolution:state.baker.probeResolution,
    maximum_probes:state.baker.maximumProbes,
    spacing:state.baker.spacing,
  };
  profile.area_lights = state.areaLights
    .filter((row)=>row.level===levelDir)
    .map((raw)=>{
      const row=normalizeAreaLight(raw);
      return {position:row.position,axis_u:row.axis_u,axis_v:row.axis_v,radiance:row.radiance};
    });
  return profile;
}

function tsvValue(value) {
  return String(value).replace(/[\t\r\n]/g," ");
}

export function particleConfig(state, levels) {
  const numberByDir = new Map(levels.map((row)=>[row.dir,row.level]));
  const header = [
    "# OpenRAC Graphics Effects Runtime v1",
    "# level\tpreset\tx\ty\tz\tr\tg\tb\ta\trate\tlife\tsize\tspeed\tspread\tgravity\thazeRadius\thazeStrength",
  ];
  for (const raw of state.particles) {
    const p = normalizeParticle(raw);
    const level = numberByDir.get(p.level);
    if (!Number.isInteger(level)) continue;
    header.push([
      level,p.preset,...p.position,...p.colour,p.alpha,p.rate,p.life,p.size,p.speed,p.spread,p.gravity,p.hazeRadius,p.hazeStrength
    ].map(tsvValue).join("\t"));
  }
  return header.join("\n")+"\n";
}

export async function saveText(controller, name, extension, text) {
  const token = await controller.saveStart(name, extension);
  if (!token) return null;
  try {
    await controller.saveWrite(token, encoder.encode(text));
    return await controller.saveEnd(token, true);
  } catch (error) {
    await controller.saveEnd(token, false).catch(()=>undefined);
    throw error;
  }
}

export async function exportBakerProfile(controller, info, state, levelDir, baseProfile) {
  const profile = bakerProfile(baseProfile,state,levelDir);
  const name = `${info.packId}-${levelDir}-probe-bake`;
  return saveText(controller,name,"json",JSON.stringify(profile,null,2)+"\n");
}

export async function exportEffectsMod(controller, info, state, levels) {
  const id = `graphics-effects-${info.game}-${info.version}`.replace(/[^a-z0-9-]+/g,"-");
  const token = await controller.saveStart(id,"zip");
  if (!token) return null;
  const zip = new ZipStream(controller,token);
  try {
    const root = id + "/";
    const manifest = {
      format:2,
      id,
      name:`Graphics effects · ${info.game}/${info.version}`,
      version:"1.0.0",
      author:"Moritz Wallinger",
      description:"Authored runtime lights and particle effects made with Graphics preparation.",
      license:"GPL-3.0-or-later",
      api:"1.14",
      type:"script",
      scripts:["main.luau"],
      assets:"assets",
      games:{[info.game]:[info.version]},
      requires:[{id:"graphics-effects-runtime",version:">=0.1.0"}],
      multiplayer:"cosmetic",
    };
    const noop = "-- Generated by Graphics preparation. Runtime effects are handled by graphics-effects-runtime.\n";
    await zip.add(root+"openrac-mod.json",encoder.encode(JSON.stringify(manifest,null,2)+"\n"));
    await zip.add(root+"main.luau",encoder.encode(noop));
    await zip.add(root+"assets/object-lights.json",encoder.encode(JSON.stringify(objectLightCatalog(state),null,2)+"\n"));
    await zip.add(root+"graphics-effects.tsv",encoder.encode(particleConfig(state,levels)));
    const note = [
      "OpenRAC Graphics effects",
      "",
      "Install this ZIP through Mods -> Add a mod.",
      "Runtime point/spot lights are read from assets/object-lights.json by Enhanced graphics.",
      "Particles require the standard OpenRAC native mod graphics-effects-runtime >= 0.1.0.",
      "Bake-only area lights are exported separately as probe-bake.json and use Enhanced graphics -> Prepare lighting.",
      "",
    ].join("\n");
    await zip.add(root+"README.txt",encoder.encode(note));
    return await zip.finish();
  } catch (error) {
    await zip.cancel().catch(()=>undefined);
    throw error;
  }
}

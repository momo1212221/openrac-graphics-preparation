// SPDX-License-Identifier: GPL-3.0-or-later
import {ZipStream} from "./zip.js";
import {DEFAULT_BAKER_SETTINGS,bakerSettingsIssues,normalizeBakerSettings} from "./enhanced-baker-schema.js";

const encoder = new TextEncoder();
const dec = new TextDecoder();

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const vec3 = (value, fallback) => Array.from({length:3}, (_,i)=>safeNumber(value?.[i], fallback[i]));
const finiteVec3 = (value) => {
  if (!Array.isArray(value) || value.length < 3) return null;
  const raw = value.slice(0,3);
  if (!raw.every((item)=>typeof item === "number" && Number.isFinite(item))) return null;
  return raw;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
export const EFFECTS_SCHEMA_VERSION = 3;

export function manifestObjectPosition(entry = {}) {
  for (const candidate of [
    entry.position,
    entry.translation,
    entry.origin,
    entry.transform?.position,
    entry.transform?.translation,
  ]) {
    const position = finiteVec3(candidate);
    if (position) return position;
  }
  const matrix = Array.isArray(entry.matrix) ? entry.matrix : entry.transform?.matrix;
  if (Array.isArray(matrix) && matrix.length >= 16) {
    const position = [Number(matrix[12]),Number(matrix[13]),Number(matrix[14])];
    if (position.every(Number.isFinite)) return position;
  }
  return null;
}

export const DEFAULT_EFFECTS = {
  schemaVersion: EFFECTS_SCHEMA_VERSION,
  selectedLevel: "",
  selectedObject: "",
  selectedPlacement: "",
  baker: {...DEFAULT_BAKER_SETTINGS},
  bakerByLevel: {},
  lights: [],
  areaLights: [],
  particles: [],
};

export function normalizeEffects(value) {
  const src = value && typeof value === "object" ? value : {};
  const legacy = Number(src.schemaVersion || 0) < EFFECTS_SCHEMA_VERSION;
  const particles = Array.isArray(src.particles) ? src.particles.map((row)=>normalizeParticle(legacy && !["manual","object","unplaced"].includes(row?.placement) ? {...(row&&typeof row==="object"?row:{}),placement:"unplaced"} : row)) : [];
  const areaLights = Array.isArray(src.areaLights) ? src.areaLights.map((row)=>normalizeAreaLight(legacy && !["manual","object","unplaced"].includes(row?.placement) ? {...(row&&typeof row==="object"?row:{}),placement:"unplaced"} : row)) : [];
  const bakerByLevel={};
  if(src.bakerByLevel&&typeof src.bakerByLevel==="object"){ for(const [level,settings] of Object.entries(src.bakerByLevel)){ if(/^level_\d+$/.test(level))bakerByLevel[level]=normalizeBakerSettings(settings); } }
  if(legacy&&typeof src.selectedLevel==="string"&&/^level_\d+$/.test(src.selectedLevel)&&!bakerByLevel[src.selectedLevel])bakerByLevel[src.selectedLevel]=normalizeBakerSettings(src.baker);
  return {
    schemaVersion:EFFECTS_SCHEMA_VERSION,
    selectedLevel:typeof src.selectedLevel==="string"?src.selectedLevel:"",
    selectedObject:typeof src.selectedObject==="string"?src.selectedObject:"",
    selectedPlacement:typeof src.selectedPlacement==="string"?src.selectedPlacement:"",
    baker:normalizeBakerSettings(src.baker), bakerByLevel,
    lights:Array.isArray(src.lights)?src.lights.map(normalizeLight):[], areaLights, particles,
  };
}

export function bakerSettingsForLevel(state,levelDir,baseProfile={}){
  const saved=state?.bakerByLevel&&typeof state.bakerByLevel==="object"?state.bakerByLevel[levelDir]:null;
  return normalizeBakerSettings(saved||{},baseProfile);
}

export function setBakerSettingsForLevel(state,levelDir,settings){
  const normalized=normalizeBakerSettings(settings);
  if(!state.bakerByLevel||typeof state.bakerByLevel!=="object")state.bakerByLevel={};
  if(levelDir)state.bakerByLevel[levelDir]=clone(normalized);
  state.baker=clone(normalized);
  return state.baker;
}

export function normalizeLight(value = {}) {
  value = value && typeof value === "object" ? value : {};
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
    range: Math.max(0.01,safeNumber(value.range,12)),
    inner_angle: Math.max(0,Math.min(1.55,safeNumber(value.inner_angle,0.25))),
    outer_angle: Math.max(0,Math.min(1.56,safeNumber(value.outer_angle,0.55))),
  };
}

export function normalizeAreaLight(value = {}) {
  value=value&&typeof value==="object"?value:{};
  const explicitPosition=finiteVec3(value.position);
  const requested=["manual","object","unplaced"].includes(value.placement)?value.placement:(explicitPosition?"manual":"unplaced");
  const placement=explicitPosition&&requested!=="unplaced"?requested:"unplaced";
  return {
    level:String(value.level||""), placement, anchorObject:placement==="object"?String(value.anchorObject||"").slice(0,256):"",
    position:explicitPosition||[0,0,0], axis_u:vec3(value.axis_u,[2,0,0]), axis_v:vec3(value.axis_v,[0,2,0]),
    radiance:vec3(value.radiance,[8,6,3]).map(v=>Math.max(0,Math.min(1e6,v))),
  };
}

export function normalizeParticle(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const presets = ["sparks","smoke","smog","mist","glow","energy","rain","heat-haze"];
  const explicitPosition = finiteVec3(value.position);
  const requestedPlacement = ["manual","object","unplaced"].includes(value.placement)
    ? value.placement
    : explicitPosition ? "manual" : "unplaced";
  const placement = explicitPosition && requestedPlacement !== "unplaced"
    ? requestedPlacement
    : "unplaced";
  return {
    level: String(value.level || ""),
    preset: presets.includes(value.preset) ? value.preset : "sparks",
    placement,
    anchorObject: placement === "object" ? String(value.anchorObject || "").slice(0,256) : "",
    position: explicitPosition || [0,0,0],
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

const stem = (path) => String(path || "").replace(/\.(?:glb|gltf)$/i,"");

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

export function placementsFromLevel(manifest, placements) {
  const out = [];
  const classMaps = manifest?.classes || {};
  const layers = [
    ["ties","tie"],
    ["shrubs","shrub"],
    ["mobys","moby"],
  ];
  for (const [plural,singular] of layers) {
    const rows = Array.isArray(placements?.[plural]) ? placements[plural] : [];
    rows.forEach((entry,rowIndex)=>{
      const position = manifestObjectPosition(entry);
      if (!position) return;
      const classId = String(entry?.class ?? "");
      const index = Number.isInteger(entry?.index) ? entry.index : rowIndex;
      const classEntry = classMaps?.[singular]?.[classId] || {};
      const mesh = typeof classEntry.mesh === "string" ? classEntry.mesh : "";
      const name = classEntry.name || stem(mesh).split("/").pop() || `${singular} class ${classId || "?"}`;
      out.push({
        key:`${singular}:${classId || "?"}:${index}`,
        layer:singular,
        classId,
        index,
        name,
        label:`${singular} ${index} · class ${classId || "?"} · ${name}`,
        position,
      });
    });
  }
  return out.sort((a,b)=>a.label.localeCompare(b.label));
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
      let placements = {};
      const placementsName = typeof manifest.placements === "string" && manifest.placements
        ? manifest.placements.replace(/^\/+/, "")
        : "placements.json";
      if (!placementsName.split("/").includes("..")) {
        try {
          const placementRaw = await controller.read("levels", `${dir}/${placementsName}`);
          const parsed = JSON.parse(dec.decode(placementRaw));
          if (parsed && typeof parsed === "object") placements = parsed;
        } catch {
          placements = {};
        }
      }
      out.push({
        dir,
        level:Number.isInteger(manifest.level) ? manifest.level : Number(dir.replace("level_","")),
        manifest,
        objects:objectsFromManifest(manifest),
        placements:placementsFromLevel(manifest,placements),
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

const vectorLength=(v)=>Math.hypot(Number(v?.[0]),Number(v?.[1]),Number(v?.[2]));
const crossLength=(a,b)=>Math.hypot(Number(a?.[1])*Number(b?.[2])-Number(a?.[2])*Number(b?.[1]),Number(a?.[2])*Number(b?.[0])-Number(a?.[0])*Number(b?.[2]),Number(a?.[0])*Number(b?.[1])-Number(a?.[1])*Number(b?.[0]));

const bakedAreaLight=(raw)=>{
  const row=normalizeAreaLight(raw);
  return {position:row.position,axis_u:row.axis_u,axis_v:row.axis_v,radiance:row.radiance};
};
const areaSignature=(row)=>JSON.stringify([row?.position,row?.axis_u,row?.axis_v,row?.radiance]);

export function mergedAreaLights(baseProfile,state,levelDir){
  const out=[],seen=new Set();
  const add=(row)=>{
    if(!row||typeof row!=="object")return;
    const baked=bakedAreaLight(row),sig=areaSignature(baked);
    if(seen.has(sig))return;
    seen.add(sig);out.push(baked);
  };
  if(Array.isArray(baseProfile?.area_lights))baseProfile.area_lights.forEach(add);
  (state?.areaLights||[]).filter(row=>row?.level===levelDir).forEach(add);
  return out;
}

export function bakerExportIssues(state,levelDir,baseProfile={}){
  const issues=[]; if(!/^level_\d+$/.test(String(levelDir||"")))issues.push("Select an exported level");
  const settings=bakerSettingsForLevel(state,levelDir,baseProfile); issues.push(...bakerSettingsIssues(settings));
  const rows=(state?.areaLights||[]).filter(row=>row?.level===levelDir);
  if(mergedAreaLights(baseProfile,state,levelDir).length>64)issues.push("Enhanced Baker supports at most 64 area lights per level");
  rows.forEach((raw,index)=>{
    const area=normalizeAreaLight(raw), label=`Area light ${index+1}`;
    if(area.placement==="unplaced")issues.push(`${label}: placement is not confirmed`);
    if(!finiteVec3(raw?.position))issues.push(`${label}: X/Y/Z must be finite numbers`);
    if(vectorLength(area.axis_u)<=1e-6||vectorLength(area.axis_v)<=1e-6||crossLength(area.axis_u,area.axis_v)<=1e-6)issues.push(`${label}: half-edge U/V must form a non-degenerate rectangle`);
    if(!area.radiance.every(v=>Number.isFinite(v)&&v>=0&&v<=1e6))issues.push(`${label}: radiance must be finite and non-negative`);
  });
  return issues;
}

export function bakerProfile(baseProfile,state,levelDir){
  const profile=clone(baseProfile&&typeof baseProfile==="object"?baseProfile:{});
  const settings=bakerSettingsForLevel(state,levelDir,profile);
  profile.version=Number.isInteger(profile.version)?profile.version:1;
  profile.sky_intensity=settings.skyIntensity; profile.sky_weight=settings.skyWeight; profile.surface_emission_scale=settings.surfaceEmissionScale;
  profile.rays=settings.rays; profile.bounces=settings.bounces; profile.adaptive_rays=settings.adaptiveRays;
  profile.environment_probes={...(profile.environment_probes&&typeof profile.environment_probes==="object"?profile.environment_probes:{}),enabled:settings.environmentProbes,resolution:settings.probeResolution,maximum_probes:settings.maximumProbes,spacing:settings.spacing};
  profile.area_lights=mergedAreaLights(profile,state,levelDir);
  return profile;
}

function tsvValue(value) {
  return String(value).replace(/[\t\r\n]/g," ");
}

export function objectLightIssues(state){
  const issues=[];
  const rows=Array.isArray(state?.lights)?state.lights:[];
  if(rows.length>4096)issues.push("Enhanced renderer supports at most 4096 authored local lights");
  rows.forEach((raw,index)=>{
    const light=normalizeLight(raw), label=`Light ${index+1} (${light.name})`;
    if(!light.object)issues.push(`${label}: no object is selected`);
    if(!Number.isFinite(light.range)||light.range<=0)issues.push(`${label}: range must be positive`);
    if(!Number.isFinite(light.intensity)||light.intensity<0)issues.push(`${label}: intensity must be non-negative`);
    if(!light.position.every(Number.isFinite)||!light.colour.every(v=>Number.isFinite(v)&&v>=0))issues.push(`${label}: position/colour must be finite and colour non-negative`);
    if(light.type==="spot"){
      const axis=Math.hypot(...light.direction);
      if(!Number.isFinite(axis)||axis<1e-6)issues.push(`${label}: spot direction must be non-zero`);
      const inner=Math.min(light.inner_angle,light.outer_angle), outer=Math.max(light.inner_angle,light.outer_angle);
      if(inner<0||outer>=Math.PI/2)issues.push(`${label}: spot angles must satisfy 0 <= inner <= outer < pi/2`);
    }
  });
  return issues;
}
export function effectExportIssues(state, levels) {
  const issues = [...objectLightIssues(state)];
  const validRows=(levels || []).filter((row)=>/^level_\d+$/.test(String(row?.dir||""))&&Number.isInteger(row?.level));
  const validLevels = new Set(validRows.map((row)=>row.dir));
  if((state?.lights||[]).length && !validRows.length)issues.push("Runtime object lights need at least one exported level");

  (state?.particles || []).forEach((raw,index)=>{
    const p = normalizeParticle(raw);
    const label = `Effect ${index+1} (${p.preset})`;
    if (!p.level || !validLevels.has(p.level)) issues.push(`${label}: level is unavailable`);
    if (p.placement === "unplaced") issues.push(`${label}: placement is not confirmed`);
    if (!finiteVec3(raw?.position)) issues.push(`${label}: X/Y/Z must be finite numbers`);
  });
  return issues;
}

export function particleConfig(state, levels) {
  const numberByDir = new Map(levels.map((row)=>[row.dir,row.level]));
  const header = [
    "# OpenRAC Graphics Effects Runtime v1",
    "# level\tpreset\tx\ty\tz\tr\tg\tb\ta\trate\tlife\tsize\tspeed\tspread\tgravity\thazeRadius\thazeStrength",
  ];
  for (const raw of state?.particles || []) {
    const p = normalizeParticle(raw);
    const level = numberByDir.get(p.level);
    if (!Number.isInteger(level) || p.placement === "unplaced") continue;
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
  const issues=bakerExportIssues(state,levelDir,baseProfile);
  if(issues.length)throw new Error("Baker profile is not ready: "+issues.slice(0,3).join("; ")+(issues.length>3?" (+"+(issues.length-3)+" more)":""));
  const profile = bakerProfile(baseProfile,state,levelDir);
  const name = `${info.packId}-${levelDir}-probe-bake`;
  return saveText(controller,name,"json",JSON.stringify(profile,null,2)+"\n");
}

export async function exportEffectsMod(controller, info, state, levels) {
  const issues=effectExportIssues(state,levels);
  if(issues.length){
    throw new Error(`Runtime effects are not ready to export: ${issues.slice(0,3).join("; ")}${issues.length>3?` (+${issues.length-3} more)`:""}`);
  }
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
      api:"1.1",
      type:"script",
      scripts:["main.luau"],
      assets:"assets",
      games:{[info.game]:[info.version]},
      requires:[{id:"graphics-preparation",version:">=0.17.0"}],
      multiplayer:"cosmetic",
    };
    const noop = "-- Generated by Graphics preparation. Runtime effects are handled by the native runtime integrated into graphics-preparation >= 0.17.0.\n";
    await zip.add(root+"openrac-mod.json",encoder.encode(JSON.stringify(manifest,null,2)+"\n"));
    await zip.add(root+"main.luau",encoder.encode(noop));
    const objectLights=encoder.encode(JSON.stringify(objectLightCatalog(state),null,2)+"\n");
    if((state?.lights||[]).length){
      for(const level of levels.filter((row)=>/^level_\d+$/.test(String(row?.dir||""))&&Number.isInteger(row?.level))){
        // Stock OpenRAC turns a mod's assets root into assets/level_NN for the loaded world.
        // Enhanced object_lights.cpp reads object-lights.json from that per-level mod root.
        await zip.add(root+"assets/"+level.dir+"/object-lights.json",objectLights);
      }
    }
    await zip.add(root+"graphics-effects.tsv",encoder.encode(particleConfig(state,levels)));
    const note = [
      "OpenRAC Graphics effects",
      "",
      "Install this ZIP through Mods -> Add a mod.",
      "Runtime point/spot lights are copied to assets/level_NN/object-lights.json, the per-level mod root used by standard Enhanced graphics.",
      "Particles use the native runtime integrated into Graphics preparation >= 0.17.0; no second runtime mod is required.",
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

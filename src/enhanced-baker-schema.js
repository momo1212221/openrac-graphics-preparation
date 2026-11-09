// SPDX-License-Identifier: GPL-3.0-or-later
// Exact stock OpenRAC Enhanced-baker limits used by the authoring UI.

export const BAKER_RESOLUTIONS=Object.freeze([4,8,16,32,64,128,256]);
export const DEFAULT_BAKER_SETTINGS=Object.freeze({
  skyIntensity:1, skyWeight:0.7, surfaceEmissionScale:1, environmentProbes:false,
  probeResolution:64, maximumProbes:512, spacing:24, rays:128, bounces:2, adaptiveRays:true,
});

const own=(v,k)=>v&&typeof v==="object"&&Object.prototype.hasOwnProperty.call(v,k);
const finite=(v,f)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const integer=(v,f,a,b)=>Math.round(clamp(finite(v,f),a,b));
const pick=(v,k,b,bk,f)=>own(v,k)?v[k]:own(b,bk)?b[bk]:f;
const nearestResolution=(v)=>{const n=finite(v,64);return BAKER_RESOLUTIONS.reduce((best,x)=>Math.abs(x-n)<Math.abs(best-n)?x:best,BAKER_RESOLUTIONS[0])};

export function normalizeBakerSettings(value={},baseProfile={}){
  value=value&&typeof value==="object"?value:{}; baseProfile=baseProfile&&typeof baseProfile==="object"?baseProfile:{};
  const env=baseProfile.environment_probes&&typeof baseProfile.environment_probes==="object"?baseProfile.environment_probes:{};
  const enabled=pick(value,"environmentProbes",env,"enabled",DEFAULT_BAKER_SETTINGS.environmentProbes);
  const adaptive=pick(value,"adaptiveRays",baseProfile,"adaptive_rays",DEFAULT_BAKER_SETTINGS.adaptiveRays);
  return {
    skyIntensity:clamp(finite(pick(value,"skyIntensity",baseProfile,"sky_intensity",DEFAULT_BAKER_SETTINGS.skyIntensity),DEFAULT_BAKER_SETTINGS.skyIntensity),0,1e6),
    skyWeight:clamp(finite(pick(value,"skyWeight",baseProfile,"sky_weight",DEFAULT_BAKER_SETTINGS.skyWeight),DEFAULT_BAKER_SETTINGS.skyWeight),0,1),
    surfaceEmissionScale:clamp(finite(pick(value,"surfaceEmissionScale",baseProfile,"surface_emission_scale",DEFAULT_BAKER_SETTINGS.surfaceEmissionScale),DEFAULT_BAKER_SETTINGS.surfaceEmissionScale),0,1e6),
    environmentProbes:enabled!==false,
    probeResolution:nearestResolution(pick(value,"probeResolution",env,"resolution",DEFAULT_BAKER_SETTINGS.probeResolution)),
    maximumProbes:integer(pick(value,"maximumProbes",env,"maximum_probes",DEFAULT_BAKER_SETTINGS.maximumProbes),DEFAULT_BAKER_SETTINGS.maximumProbes,1,512),
    spacing:clamp(finite(pick(value,"spacing",env,"spacing",DEFAULT_BAKER_SETTINGS.spacing),DEFAULT_BAKER_SETTINGS.spacing),2,1024),
    rays:integer(pick(value,"rays",baseProfile,"rays",DEFAULT_BAKER_SETTINGS.rays),DEFAULT_BAKER_SETTINGS.rays,16,1048576),
    bounces:integer(pick(value,"bounces",baseProfile,"bounces",DEFAULT_BAKER_SETTINGS.bounces),DEFAULT_BAKER_SETTINGS.bounces,0,32),
    adaptiveRays:adaptive!==false,
  };
}

export function bakerSettingsIssues(value={}){
  const issues=[];
  const check=(k,min,max,label)=>{const n=Number(value?.[k]);if(!Number.isFinite(n)||n<min||n>max)issues.push(`${label} must be between ${min} and ${max}`)};
  check("skyIntensity",0,1e6,"Sky intensity"); check("skyWeight",0,1,"Sky weight"); check("surfaceEmissionScale",0,1e6,"Surface emission"); check("spacing",2,1024,"Environment probe spacing");
  const r=Number(value?.probeResolution); if(!Number.isInteger(r)||!BAKER_RESOLUTIONS.includes(r))issues.push("Environment probe resolution must be a power of two from 4 to 256");
  const m=Number(value?.maximumProbes); if(!Number.isInteger(m)||m<1||m>512)issues.push("Maximum environment probes must be an integer from 1 to 512");
  const rays=Number(value?.rays); if(!Number.isInteger(rays)||rays<16||rays>1048576)issues.push("Rays must be an integer from 16 to 1048576");
  const b=Number(value?.bounces); if(!Number.isInteger(b)||b<0||b>32)issues.push("Bounces must be an integer from 0 to 32");
  return issues;
}

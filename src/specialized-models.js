// SPDX-License-Identifier: GPL-3.0-or-later

let registryPromise;

function validEntry(material,entry){
  return typeof material==="string" && entry && typeof entry==="object" &&
    /^detail-[a-z0-9-]+\.onnx$/.test(String(entry.file||"")) &&
    /^[a-f0-9]{64}$/.test(String(entry.sha256||"")) &&
    typeof entry.validation==="string";
}

export function normalizeSpecializedRegistry(value){
  const out={version:1,models:{}};
  if(!value||value.version!==1||!value.models||typeof value.models!=="object")return out;
  for(const [material,entry] of Object.entries(value.models)){
    if(validEntry(material,entry))out.models[material]={...entry};
  }
  return out;
}

export function acceptSpecializedRefinement(base,candidate){
  if(!base||!candidate)return false;
  const scoreOk=Number(candidate.score)>=Number(base.score)-.75;
  const hallucinationOk=Number(candidate.hallucinationScore)<=Number(base.hallucinationScore)+2;
  const colorOk=Number(candidate.colorDrift)<=Number(base.colorDrift)+1.5;
  const lumaOk=base.lumaDrift===undefined||candidate.lumaDrift===undefined||
    Number(candidate.lumaDrift)<=Number(base.lumaDrift)+2;
  const ssimOk=base.ssim===undefined||candidate.ssim===undefined||
    Number(candidate.ssim)>=Number(base.ssim)-.01;
  const psnrOk=base.psnr===undefined||candidate.psnr===undefined||
    Number(candidate.psnr)>=Number(base.psnr)-1;
  const edgeOk=base.edgeGain===undefined||candidate.edgeGain===undefined||
    Number(candidate.edgeGain)<=Math.max(Number(base.edgeGain)*1.15,Number(base.edgeGain)+.25);
  const alphaOk=base.alphaCoverageDiff===undefined||candidate.alphaCoverageDiff===undefined||
    Number(candidate.alphaCoverageDiff)<=Number(base.alphaCoverageDiff)+1;
  return scoreOk&&hallucinationOk&&colorOk&&lumaOk&&ssimOk&&psnrOk&&edgeOk&&alphaOk;
}

export async function specializedRegistry(){
  if(!registryPromise){
    registryPromise=fetch(new URL("../models/specialized-models.json",import.meta.url))
      .then(async(r)=>r.ok?normalizeSpecializedRegistry(await r.json()):normalizeSpecializedRegistry(null))
      .catch(()=>normalizeSpecializedRegistry(null));
  }
  return registryPromise;
}

export async function specializedRegistryIdentity(){
  const registry=await specializedRegistry();
  const canonical=Object.entries(registry.models||{})
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([material,entry])=>material+":"+entry.sha256)
    .join("|");
  if(!canonical)return "none";
  if(typeof crypto!=="undefined"&&crypto.subtle){
    try{
      const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical));
      return [...new Uint8Array(bytes)].map((b)=>b.toString(16).padStart(2,"0")).join("");
    }catch{}
  }
  return canonical;
}

export async function sha256Hex(bytes){
  if(typeof crypto==="undefined"||!crypto.subtle)throw new Error("SHA-256 is unavailable");
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const digest=await crypto.subtle.digest("SHA-256",view);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,"0")).join("");
}

export async function verifySpecializedModelBytes(entry,bytes){
  if(!entry||!/^[a-f0-9]{64}$/.test(String(entry.sha256||"")))return false;
  return (await sha256Hex(bytes))===entry.sha256;
}

export async function specializedModelFor(material){
  const registry=await specializedRegistry();
  const entry=registry.models?.[material]||null;
  if(!entry)return null;
  return {
    material,
    entry,
    url:new URL("../models/"+entry.file,import.meta.url),
  };
}

export function resetSpecializedRegistryForTests(){
  registryPromise=undefined;
}

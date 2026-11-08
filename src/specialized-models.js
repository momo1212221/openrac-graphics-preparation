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

export async function specializedRegistry(){
  if(!registryPromise){
    registryPromise=fetch(new URL("../models/specialized-models.json",import.meta.url))
      .then(async(r)=>r.ok?normalizeSpecializedRegistry(await r.json()):normalizeSpecializedRegistry(null))
      .catch(()=>normalizeSpecializedRegistry(null));
  }
  return registryPromise;
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

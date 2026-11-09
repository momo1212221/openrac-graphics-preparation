// SPDX-License-Identifier: GPL-3.0-or-later

export const PERFORMANCE_MODES=Object.freeze(["auto","1","2","3"]);

export function normalizePerformanceMode(value){
  const mode=String(value??"auto");
  return PERFORMANCE_MODES.includes(mode)?mode:"auto";
}

export function hardwareSnapshot(nav=globalThis.navigator){
  const hardwareConcurrency=Math.max(1,Math.floor(Number(nav?.hardwareConcurrency)||1));
  const deviceMemoryGb=Number(nav?.deviceMemory);
  return {
    hardwareConcurrency,
    deviceMemoryGb:Number.isFinite(deviceMemoryGb)&&deviceMemoryGb>0?deviceMemoryGb:null,
    webgpu:!!nav?.gpu,
  };
}

export function laneCeiling({backend="wasm",mode="auto",hardware=hardwareSnapshot()}={}){
  const normalized=normalizePerformanceMode(mode);
  if(normalized!=="auto")return Math.max(1,Math.min(3,Number(normalized)||1));
  if(!String(backend).startsWith("webgpu"))return 1;

  const cores=Math.max(1,Number(hardware?.hardwareConcurrency)||1);
  const memory=Number(hardware?.deviceMemoryGb);
  let lanes=cores>=12?3:cores>=6?2:1;

  // deviceMemory is privacy-rounded/capped on many browsers. Treat it only as a
  // conservative ceiling, never as an exact physical-RAM measurement.
  if(Number.isFinite(memory)){
    if(memory<6)lanes=1;
    else if(memory<10)lanes=Math.min(lanes,2);
  }
  return lanes;
}

export function selectMeasuredLaneCount(measurements,{minimumGain=.08}={}){
  const rows=(measurements||[])
    .filter((row)=>Number(row?.lanes)>=1&&Number(row?.runs)>0&&Number(row?.elapsedMs)>0)
    .map((row)=>({
      ...row,
      lanes:Math.floor(Number(row.lanes)),
      throughput:Number(row.runs)/Number(row.elapsedMs),
    }))
    .sort((a,b)=>a.lanes-b.lanes);
  if(!rows.length)return 1;

  let best=rows[0];
  for(const row of rows.slice(1)){
    if(row.throughput>=best.throughput*(1+minimumGain))best=row;
  }
  return Math.max(1,Math.min(3,best.lanes));
}

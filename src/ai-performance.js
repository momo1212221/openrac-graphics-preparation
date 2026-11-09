// SPDX-License-Identifier: GPL-3.0-or-later

export const MAX_INFERENCE_LANES=8;
export const PERFORMANCE_MODES=Object.freeze([
  "auto","1","2","3","4","5","6","7","8",
]);

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
  if(normalized!=="auto"){
    return Math.max(1,Math.min(MAX_INFERENCE_LANES,Number(normalized)||1));
  }
  if(!String(backend).startsWith("webgpu"))return 1;

  // CPU thread count is only a coarse device-class hint. The real decision is made by the
  // runtime benchmark below, so reasonably capable WebGPU devices may probe all eight lanes.
  const cores=Math.max(1,Number(hardware?.hardwareConcurrency)||1);
  let lanes=cores<=2?2:cores<=4?4:cores<=6?6:MAX_INFERENCE_LANES;

  // navigator.deviceMemory is privacy-rounded and often capped. Only very small reported
  // values are used as a hard safety signal; 8 GB must not incorrectly cap a 16/24/32 GB Mac.
  const memory=Number(hardware?.deviceMemoryGb);
  if(Number.isFinite(memory)){
    if(memory<4)lanes=1;
    else if(memory<6)lanes=Math.min(lanes,2);
  }
  return Math.max(1,Math.min(MAX_INFERENCE_LANES,lanes));
}

function normalizedMeasurements(measurements){
  return (measurements||[])
    .filter((row)=>Number(row?.lanes)>=1&&Number(row?.runs)>0&&Number(row?.elapsedMs)>0)
    .map((row)=>({
      ...row,
      lanes:Math.floor(Number(row.lanes)),
      throughput:Number(row.runs)/Number(row.elapsedMs),
    }))
    .sort((a,b)=>a.lanes-b.lanes);
}

export function selectMeasuredLaneCount(measurements,{minimumGain=.06}={}){
  const rows=normalizedMeasurements(measurements);
  if(!rows.length)return 1;

  let best=rows[0];
  for(const row of rows.slice(1)){
    if(row.throughput>=best.throughput*(1+minimumGain))best=row;
  }
  return Math.max(1,Math.min(MAX_INFERENCE_LANES,best.lanes));
}

export function shouldStopAutotune(measurements,{minimumGain=.06,patience=2}={}){
  const rows=normalizedMeasurements(measurements);
  const wait=Math.max(1,Math.floor(Number(patience)||1));
  if(rows.length<wait+1)return false;

  const baselineRows=rows.slice(0,-wait);
  if(!baselineRows.length)return false;
  const baseline=Math.max(...baselineRows.map((row)=>row.throughput));
  const recent=rows.slice(-wait);
  return recent.every((row)=>row.throughput<baseline*(1+minimumGain));
}

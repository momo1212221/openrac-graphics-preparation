// SPDX-License-Identifier: GPL-3.0-or-later
export function detectOutputFailures(source,output,metrics={}){
  const issues=[];
  if(!output||!source)return {ok:false,issues:["missing-image"]};
  if(output.width!==source.width*4||output.height!==source.height*4)issues.push("wrong-dimensions");
  let visible=0,black=0,opaque=0;
  const d=output.data||[];
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]>=16){visible++;if(d[i]<3&&d[i+1]<3&&d[i+2]<3)black++;}
    if(d[i+3]>=250)opaque++;
  }
  if(visible===0)issues.push("transparent-output");
  if(visible&&black/visible>.985)issues.push("black-output");
  if(metrics.alphaDrift>18)issues.push("alpha-loss");
  if(metrics.edgeGain>3.6)issues.push("over-detail");
  if(metrics.cnnAgreement!==undefined&&metrics.cnnAgreement<.2)issues.push("cnn-disagreement");
  if(metrics.hallucinationScore!==undefined&&metrics.hallucinationScore>70)issues.push("hallucination-risk");\n  if(metrics.cnnRejectedRatio!==undefined&&metrics.cnnRejectedRatio>.6)issues.push("cnn-local-rejection");
  if(metrics.expectSeamless===true&&metrics.seamScore!==undefined&&metrics.seamScore>35)issues.push("seam-risk");
  return {ok:issues.length===0,issues,visiblePixels:visible,opaquePixels:opaque};
}

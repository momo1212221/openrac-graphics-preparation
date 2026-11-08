// SPDX-License-Identifier: GPL-3.0-or-later
const paths = (value) => (Array.isArray(value) ? value : [value])
  .filter((v)=>typeof v==="string").map((v)=>v.toLowerCase());

const has=(rows,re)=>rows.some((p)=>re.test(p));

function stats(imageData){
  const {data,width,height}=imageData;
  const pixels=width*height;
  const stride=Math.max(1,Math.floor(pixels/4096));
  let n=0,lumaSum=0,satSum=0,dark=0,bright=0,alphaVar=0,prevAlpha=null;
  let edge=0,edgeN=0;
  const lum=(r,g,b)=>(54*r+183*g+19*b)/256;
  for(let p=0;p<pixels;p+=stride){
    const i=p*4,r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
    if(a<16)continue;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),y=lum(r,g,b);
    n++;lumaSum+=y;satSum+=mx?((mx-mn)/mx):0;
    if(y<48)dark++;if(y>190)bright++;
    if(prevAlpha!==null)alphaVar+=Math.abs(a-prevAlpha);prevAlpha=a;
    const x=p%width,y0=Math.floor(p/width);
    if(x+1<width){
      const j=i+4;edge+=Math.abs(lum(r,g,b)-lum(data[j],data[j+1],data[j+2]));edgeN++;
    }
    if(y0+1<height){
      const j=i+width*4;edge+=Math.abs(lum(r,g,b)-lum(data[j],data[j+1],data[j+2]));edgeN++;
    }
  }
  return {
    saturation:n?satSum/n:0,
    luma:n?lumaSum/n:0,
    darkRatio:n?dark/n:0,
    brightRatio:n?bright/n:0,
    edgeEnergy:edgeN?edge/edgeN:0,
    alphaVariation:n?alphaVar/n:0,
  };
}

export function classifyMaterial(texturePaths,imageData,textureClass="diffuse"){
  const rows=paths(texturePaths);
  if(textureClass==="ui")return {material:"ui",confidence:1,reason:"interface"};
  if(textureClass==="normal")return {material:"normal",confidence:1,reason:"technical normal"};
  if(textureClass==="mask")return {material:"mask",confidence:1,reason:"technical mask"};
  if(textureClass==="sky")return {material:"sky",confidence:.98,reason:"sky/background"};

  const rules=[
    ["weapon",/(weapon|gun|blaster|wrench|cannon|launcher|rifle)/],
    ["character",/(ratchet|clank|character|hero|npc|enemy|boss|skin)/],
    ["terrain",/(terrain|ground|floor|sand|dirt|grass|soil)/],
    ["stone",/(rock|stone|cliff|cave|concrete|brick)/],
    ["metal",/(metal|steel|iron|chrome|machine|robot|ship|vehicle|panel)/],
    ["fabric",/(cloth|fabric|carpet|banner|flag)/],
    ["glass",/(glass|window|crystal|lens)/],
    ["organic",/(skin|flesh|wood|tree|plant|organic)/],
    ["energy",/(energy|plasma|electric|glow|emissive|laser|forcefield)/],
  ];
  for(const [material,re] of rules)if(has(rows,re))return {material,confidence:.98,reason:"path hint"};

  const s=stats(imageData);
  if(s.darkRatio>.72&&s.brightRatio>.015&&s.brightRatio<.25&&s.saturation>.35)
    return {material:"energy",confidence:.82,reason:"dark emissive-like distribution"};
  if(s.saturation<.12&&s.edgeEnergy>18&&s.luma>55&&s.luma<190)
    return {material:"metal",confidence:.68,reason:"low-chroma structured surface"};
  if(s.edgeEnergy>26&&s.saturation<.28)
    return {material:"stone",confidence:.62,reason:"high-frequency neutral surface"};
  if(s.alphaVariation>5&&s.saturation<.18)
    return {material:"glass",confidence:.55,reason:"alpha-varying low-chroma surface"};
  return {material:"generic",confidence:.5,reason:"conservative default"};
}

export const MATERIAL_DETAIL_GAIN=Object.freeze({
  generic:1,
  terrain:1.08,
  stone:1.18,
  metal:1.06,
  fabric:1.12,
  organic:.92,
  character:.88,
  weapon:1.08,
  energy:.72,
  glass:.55,
  sky:.62,
  ui:.35,
  normal:0,
  mask:0,
});

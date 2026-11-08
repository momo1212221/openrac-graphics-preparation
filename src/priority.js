// SPDX-License-Identifier: GPL-3.0-or-later
function scorePath(path=""){
  const p=path.toLowerCase();
  let score=0;
  if(/ratchet|clank|character|hero|skin/.test(p))score+=1000;
  if(/weapon|wrench|blaster|gun|launcher/.test(p))score+=900;
  if(/boss|enemy|npc/.test(p))score+=760;
  if(/terrain|ground|floor|wall|rock|stone/.test(p))score+=620;
  if(/interface/.test(p))score+=500;
  if(/sky|skybox|background/.test(p))score+=420;
  if(/particle|effect|fx/.test(p))score+=300;
  return score;
}
export function texturePriority(texture){
  return scorePath(texture?.path||"")+Math.min(400,Math.log2(Math.max(1,Number(texture?.size)||1))*18);
}
export function prioritizeGroups(groups){
  return [...groups].sort((a,b)=>{
    const aa=Math.max(...a.members.map(texturePriority));
    const bb=Math.max(...b.members.map(texturePriority));
    return bb-aa||String(a.members[0]?.path||"").localeCompare(String(b.members[0]?.path||""));
  });
}

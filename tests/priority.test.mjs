import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prioritizeGroups,texturePriority} from '../src/priority.js';
test('hero and weapon assets are processed before generic textures',()=>{
  const hero={path:'Characters/Ratchet/a.png',size:100},generic={path:'Shared/b.png',size:100};
  assert.ok(texturePriority(hero)>texturePriority(generic));
  const sorted=prioritizeGroups([{members:[generic]},{members:[hero]}]);
  assert.equal(sorted[0].members[0],hero);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('geometry helper Python unit tests pass',()=>{
  const result=spawnSync('python3',['-m','unittest','helper.test_geometry_enhance'],{
    cwd:process.cwd(),
    encoding:'utf8',
  });
  assert.equal(result.status,0,`python geometry tests failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRoutingContract,assessContextBudget} from '../src/index.js';
const descriptor=JSON.parse(readFileSync(new URL('../contracts/routing-policy.json',import.meta.url)));
test('versioned model-free descriptor preserves closed authority boundaries',()=>{
  assert.equal(validateRoutingContract(descriptor).ok,true);
  for(const value of [null,[],{...descriptor,schema_version:'unknown'},{...descriptor,mode:'active'},{...descriptor,model_id:'runtime'},{...descriptor,canonical_path:'../policy.json'},{...descriptor,invariants:descriptor.invariants.slice(1)}]) assert.equal(validateRoutingContract(value).ok,false);
});
test('context reserve follows actual runtime headroom and next phase, not a fixed reference count',()=>{
  const input={modelId:'runtime',limitsModelId:'runtime',contextWindowTokens:100000,autoCompactTokenLimit:null,autoCompactScope:'disabled',bodyTokensSinceCompaction:null,usedTokens:70000,reserveTokens:10000,nextPhaseTokens:5000};
  assert.equal(assessContextBudget(input).action,'continue');
  assert.equal(assessContextBudget({...input,nextPhaseTokens:25000}).action,'checkpoint-before-expansion');
  assert.equal(assessContextBudget({...input,limitsModelId:'previous-runtime'}).action,'checkpoint-before-expansion');
});

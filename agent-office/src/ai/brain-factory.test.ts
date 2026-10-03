import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelOf, setLiveModels } from '../core/roster.ts';
import type { AgentId } from '../core/types.ts';
import { ScriptedBrain } from '../sim/scripted-brain.ts';
import { chooseBrain } from './brain-factory.ts';
import { GeminiBrain } from './gemini-brain.ts';
import { MODEL_FOR, createModels } from './models.ts';

// A fetch that fails the test if anything tries to use the network.
const noNetwork: typeof fetch = async () => {
  throw new Error('the network must not be used in this test');
};
const models = createModels(MODEL_FOR, () => 'test-key', { fetchFn: noNetwork });

test('with a key saved the owner and secretary are played by Gemini', () => {
  const seen: { live: Partial<Record<AgentId, string>> | null } = { live: null };
  const brain = chooseBrain(models, { keySaved: () => true, onChosen: (l) => void (seen.live = l) });
  assert.ok(brain instanceof GeminiBrain);
  assert.equal(seen.live?.owner, MODEL_FOR.owner);
  assert.equal(seen.live?.secretary, MODEL_FOR.secretary);
  assert.equal(seen.live?.qa, undefined, 'the other positions still run the script');
});

test('without a key the demo script plays and no model is reported', () => {
  const seen: { live: Partial<Record<AgentId, string>> | null } = { live: { owner: 'stale' } };
  const brain = chooseBrain(models, { keySaved: () => false, onChosen: (l) => void (seen.live = l) });
  assert.ok(brain instanceof ScriptedBrain);
  assert.equal(seen.live, null);
});

test('each call decides afresh, so saving or removing a key affects the next job only', () => {
  let saved = false;
  const pick = () => chooseBrain(models, { keySaved: () => saved });
  assert.ok(pick() instanceof ScriptedBrain);
  saved = true;
  assert.ok(pick() instanceof GeminiBrain);
  saved = false;
  assert.ok(pick() instanceof ScriptedBrain);
});

test('the inspector shows the live model while a job uses one, and the roster model otherwise', () => {
  const rosterModel = modelOf('owner');
  setLiveModels({ owner: 'gemini-flash-latest' });
  assert.equal(modelOf('owner'), 'gemini-flash-latest');
  assert.equal(modelOf('qa'), modelOf('qa'), 'others are unaffected');
  assert.notEqual(modelOf('qa'), 'gemini-flash-latest');
  setLiveModels(null);
  assert.equal(modelOf('owner'), rosterModel);
});

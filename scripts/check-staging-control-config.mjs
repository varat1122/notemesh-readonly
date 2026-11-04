// Branch-only root config: Railway auto-detection and the image gate use one file.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = process.argv[2] ?? 'railway.json';
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(config.environments, undefined, 'Environment overrides require a new build-contract review');
assert.deepEqual(config.build, { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile.staging-control' });
assert.deepEqual(config.deploy, {
  preDeployCommand: ['node control/verify-artifact.mjs --canary'],
  startCommand: 'node control/main.mjs', healthcheckPath: null,
  restartPolicyType: 'NEVER', overlapSeconds: '0', drainingSeconds: '20',
});
console.log(config.build.dockerfilePath);

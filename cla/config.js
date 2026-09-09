// Swap these once the OAuth App + worker are deployed. See ../STEP-BY-STEP.md.
window.CLA_CONFIG = {
  // GitHub OAuth App "Client ID" (public value, safe to ship in JS).
  GITHUB_CLIENT_ID: 'Ov23libWTMac37SWZzH4',
  // The deployed serverless function that exchanges the OAuth code and
  // writes to signatures.json. See ../worker/.
  WORKER_URL: 'https://cla-sign-worker.sklardie-trailblazerlabs.workers.dev/',
  // Must match the top-level "claVersion" in cla-signatures/signatures.json.
  CLA_VERSION: '1.0',
  CLA_TEXT_PATH: './cla.md',
};

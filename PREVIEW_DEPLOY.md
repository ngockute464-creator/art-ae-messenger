# ART-AE preview branch

This branch is configured for Netlify Branch Deploys (`netlify-preview`).
Production branch is `test`. Do not publish this preview branch to production.

This commit is a one-time trigger made after enabling branch deploys in Netlify.

Build validation trigger after confirming Netlify build command includes `node build/prepare.mjs`.

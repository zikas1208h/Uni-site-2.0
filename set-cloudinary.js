/**
 * Sets Cloudinary env vars on Railway via their GraphQL API.
 * Run: node set-cloudinary.js
 */
const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;
const SERVICE_ID    = process.env.RAILWAY_SERVICE_ID;
const ENVIRONMENT_ID= process.env.RAILWAY_ENVIRONMENT_ID;
const PROJECT_ID    = process.env.RAILWAY_PROJECT_ID;

if (!RAILWAY_TOKEN) {
  console.log('\n❌ No RAILWAY_TOKEN env var found.');
  console.log('\n👉 To set Cloudinary vars manually in Railway:');
  console.log('   1. Go to https://railway.com/project/9924b31e-f5ca-4e57-b626-307209e61365');
  console.log('   2. Click your backend service → Variables tab');
  console.log('   3. Add these 3 variables:\n');
  console.log('      CLOUDINARY_CLOUD_NAME  = dhlvzepp6');
  console.log('      CLOUDINARY_API_KEY     = 843524639436499');
  console.log('      CLOUDINARY_API_SECRET  = gI1ZuNhXnRKwP4Gq_E6wrQoX7CU\n');
  process.exit(0);
}


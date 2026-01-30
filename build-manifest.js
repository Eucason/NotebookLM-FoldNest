#!/usr/bin/env node

/**
 * Build script for NotebookLM FoldNest
 * Generates manifest.json from template using environment variables
 * 
 * Usage:
 *   node build-manifest.js
 * 
 * Requires:
 *   - .env file with EXTENSION_KEY and OAUTH_CLIENT_ID
 *   - manifest.json.template
 */

const fs = require('fs');
const path = require('path');

// Simple .env parser (no dependencies needed)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ Error: .env file not found!');
    console.error('📝 Please copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  const envFile = fs.readFileSync(envPath, 'utf8');
  const env = {};
  
  envFile.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  return env;
}

// Main build function
function buildManifest() {
  console.log('🔨 Building manifest.json...\n');

  // Load environment variables
  const env = loadEnv();

  // Validate required variables
  const requiredVars = ['EXTENSION_KEY', 'OAUTH_CLIENT_ID'];
  const missing = requiredVars.filter(v => !env[v] || env[v].includes('YOUR_'));
  
  if (missing.length > 0) {
    console.error('❌ Error: Missing or placeholder values in .env:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\n📝 Please update .env with your actual credentials.');
    process.exit(1);
  }

  // Load template
  const templatePath = path.join(__dirname, 'manifest.json.template');
  if (!fs.existsSync(templatePath)) {
    console.error('❌ Error: manifest.json.template not found!');
    process.exit(1);
  }

  let manifestContent = fs.readFileSync(templatePath, 'utf8');

  // Replace placeholders
  manifestContent = manifestContent
    .replace('YOUR_PUBLIC_KEY_HERE', env.EXTENSION_KEY)
    .replace('YOUR_CLIENT_ID_HERE.apps.googleusercontent.com', env.OAUTH_CLIENT_ID);

  // Validate JSON
  try {
    JSON.parse(manifestContent);
  } catch (e) {
    console.error('❌ Error: Generated manifest.json is invalid JSON!');
    console.error(e.message);
    process.exit(1);
  }

  // Write manifest.json
  const manifestPath = path.join(__dirname, 'manifest.json');
  fs.writeFileSync(manifestPath, manifestContent, 'utf8');

  console.log('✅ manifest.json generated successfully!');
  console.log(`📁 Location: ${manifestPath}`);
  console.log('\n🎯 Next steps:');
  console.log('   1. Load extension in Chrome (chrome://extensions)');
  console.log('   2. Enable Developer mode');
  console.log('   3. Click "Load unpacked" and select this directory');
}

// Run build
try {
  buildManifest();
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

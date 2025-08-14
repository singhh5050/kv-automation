#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LAMBDAS_DIR = path.join(__dirname, '../services/lambdas');
const LAYERS_DIR = path.join(__dirname, '../services/layers');

function buildLambda(lambdaPath) {
  const lambdaName = path.basename(lambdaPath);
  console.log(`Building Lambda: ${lambdaName}`);
  
  const zipFile = `${lambdaName}.zip`;
  const srcDir = path.join(lambdaPath, 'src');
  
  if (!fs.existsSync(srcDir)) {
    console.log(`Skipping ${lambdaName} - no src directory found`);
    return;
  }
  
  // Create zip file with Lambda source
  execSync(`cd ${srcDir} && zip -r ../${zipFile} .`, { stdio: 'inherit' });
  
  console.log(`✓ Built ${lambdaName} → ${zipFile}`);
}

function buildLayer(layerPath) {
  const layerName = path.basename(layerPath);
  console.log(`Building Layer: ${layerName}`);
  
  const zipFile = `${layerName}-layer.zip`;
  
  // Create zip file with layer contents
  execSync(`cd ${layerPath} && zip -r ${zipFile} .`, { stdio: 'inherit' });
  
  console.log(`✓ Built ${layerName} → ${zipFile}`);
}

function main() {
  console.log('🚀 Building Lambda functions and layers...\n');
  
  // Build Lambda functions
  const lambdas = fs.readdirSync(LAMBDAS_DIR).filter(item => 
    fs.statSync(path.join(LAMBDAS_DIR, item)).isDirectory()
  );
  
  lambdas.forEach(lambda => {
    buildLambda(path.join(LAMBDAS_DIR, lambda));
  });
  
  console.log();
  
  // Build layers
  const layers = fs.readdirSync(LAYERS_DIR).filter(item => 
    fs.statSync(path.join(LAYERS_DIR, item)).isDirectory()
  );
  
  layers.forEach(layer => {
    buildLayer(path.join(LAYERS_DIR, layer));
  });
  
  console.log('\n✅ Build complete!');
}

if (require.main === module) {
  main();
}

module.exports = { buildLambda, buildLayer };

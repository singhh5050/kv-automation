#!/bin/bash
set -euo pipefail

ROOT_DIR="/Users/harshsingh/Desktop/kv-automation/services/lambdas/voice-query"
BUILD_DIR="${ROOT_DIR}/build"
ZIP_PATH="${ROOT_DIR}/voice-query.zip"

echo "🧹 Cleaning previous build artifacts..."
rm -rf "${BUILD_DIR}" "${ZIP_PATH}"
mkdir -p "${BUILD_DIR}"

echo "📦 Installing dependencies into ${BUILD_DIR}..."
python3 -m pip install --upgrade pip >/dev/null
python3 -m pip install --no-cache-dir -r "${ROOT_DIR}/requirements.txt" -t "${BUILD_DIR}"

echo "🗂️  Copying source code..."
cp -R "${ROOT_DIR}/src/." "${BUILD_DIR}/"

echo "🪄 Creating deployment zip..."
cd "${BUILD_DIR}"
zip -qr "${ZIP_PATH}" .

echo "✅ Package ready at ${ZIP_PATH}"
echo "➡️  Deploy with:"
echo "aws lambda update-function-code --function-name kv-automation-voice-query --zip-file fileb://${ZIP_PATH}"




















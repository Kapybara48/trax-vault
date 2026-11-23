#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== Building Trax Vault Android APK ==="
echo "Project Root: ${PROJECT_ROOT}"

IMAGE_NAME="trax-vault-android-builder:latest"
TARGET_APK="${PROJECT_ROOT}/trax-vault.apk"

echo "Step 1: Building Android APK inside Docker..."
export DOCKER_BUILDKIT=1
docker build -t "${IMAGE_NAME}" -f "${PROJECT_ROOT}/android/Dockerfile.build" "${PROJECT_ROOT}/android"

echo "Step 2: Extracting compiled APK from Docker image..."
CONTAINER_ID=$(docker create "${IMAGE_NAME}")
docker cp "${CONTAINER_ID}:/app/app/build/outputs/apk/debug/app-debug.apk" "${TARGET_APK}"
docker rm "${CONTAINER_ID}" >/dev/null

if [ -f "${TARGET_APK}" ]; then
    echo "=================================================="
    echo " SUCCESS: APK built successfully!"
    echo " Output path: ${TARGET_APK}"
    ls -lh "${TARGET_APK}"
    if command -v sha256sum >/dev/null 2>&1; then
        echo -n " SHA256: "
        sha256sum "${TARGET_APK}"
    fi
    echo "=================================================="
else
    echo "ERROR: Output APK not found at ${TARGET_APK}" >&2
    exit 1
fi

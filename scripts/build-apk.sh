#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== Building Trax Vault Android APK ==="
echo "Project Root: ${PROJECT_ROOT}"

IMAGE_NAME="trax-vault-android-builder:latest"

echo "Step 1: Building Android Builder Docker image..."
docker build -t "${IMAGE_NAME}" -f "${PROJECT_ROOT}/android/Dockerfile.build" "${PROJECT_ROOT}/android"

echo "Step 2: Compiling Android APK with Gradle in Docker..."
docker run --rm \
    -v "${PROJECT_ROOT}:/workspace" \
    -w /workspace/android \
    -e ANDROID_SDK_ROOT="/opt/android-sdk" \
    "${IMAGE_NAME}" \
    gradle assembleDebug --no-daemon --stacktrace

OUTPUT_APK="${PROJECT_ROOT}/android/app/build/outputs/apk/debug/app-debug.apk"
TARGET_APK="${PROJECT_ROOT}/trax-vault.apk"

if [ -f "${OUTPUT_APK}" ]; then
    cp "${OUTPUT_APK}" "${TARGET_APK}"
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
    echo "ERROR: Output APK not found at ${OUTPUT_APK}" >&2
    exit 1
fi

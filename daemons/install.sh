#!/usr/bin/env sh
set -eu

BASE_URL="${PYLON_PAGES_ORIGIN:-https://ai-pylon.github.io}"
INSTALL_DIR="${PYLON_INSTALL_DIR:-$HOME/ai-pylon-daemon}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[pylon-daemon] Fetching release metadata from ${BASE_URL}/daemons/latest.json ..."
curl -fsSL "${BASE_URL}/daemons/latest.json" -o "${TMP_DIR}/latest.json"

ZIP_URL="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); u=d["url"]; print(u if u.startswith("http") else sys.argv[2]+u)' "${TMP_DIR}/latest.json" "${BASE_URL}")"
EXPECTED_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"].lower())' "${TMP_DIR}/latest.json")"

echo "[pylon-daemon] Downloading ${ZIP_URL} ..."
curl -fsSL "${ZIP_URL}" -o "${TMP_DIR}/pylon-daemon.zip"

ACTUAL_SHA="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest().lower())' "${TMP_DIR}/pylon-daemon.zip")"
if [ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]; then
  echo "SHA-256 mismatch! Expected ${EXPECTED_SHA}, got ${ACTUAL_SHA}" >&2
  exit 1
fi
echo "[pylon-daemon] SHA-256 verified (${ACTUAL_SHA})"

mkdir -p "${INSTALL_DIR}"
python3 -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "${TMP_DIR}/pylon-daemon.zip" "${INSTALL_DIR}"

echo "[pylon-daemon] Installed to ${INSTALL_DIR}"
echo "Run client mode:"
echo "  PYLON2_DAEMON_MODE=client python3 ${INSTALL_DIR}/daemons/linux/agent.py"

#!/usr/bin/env bash
set -euo pipefail

primary_user="${NIXPI_PRIMARY_USER:-$(id -un)}"
primary_home="${HOME:-/home/${primary_user}}"
workspace_dir="${NIXPI_WORKSPACE_DIR:-${primary_home}/nixpi}"

export HOME="${primary_home}"
export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-${primary_home}/.pi}"
export NIXPI_DIR="${NIXPI_DIR:-${workspace_dir}}"
export PI_SKIP_VERSION_CHECK="${PI_SKIP_VERSION_CHECK:-1}"

mkdir -p "${PI_CODING_AGENT_DIR}"
cd "${workspace_dir}" 2>/dev/null || cd "${primary_home}"

exec /run/current-system/sw/bin/pi "$@"

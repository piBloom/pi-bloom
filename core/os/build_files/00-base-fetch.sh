#!/bin/bash
set -xeuo pipefail

dnf -y install dnf5-plugins

# Add third-party repositories
# shellcheck disable=SC1091
source /ctx/packages/repos.sh

# Install all packages from the list
grep -vE '^\s*(#|$)' /ctx/packages/packages-install.txt | xargs dnf -y install --allowerasing
dnf clean all

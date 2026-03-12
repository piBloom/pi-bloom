#!/bin/bash
set -xeuo pipefail

# Remove packages that conflict with bootc immutability or are unnecessary
grep -vE '^\s*(#|$)' /ctx/packages/packages-remove.txt | xargs dnf -y remove || true
dnf -y autoremove || true

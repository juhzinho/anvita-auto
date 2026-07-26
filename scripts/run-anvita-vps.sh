#!/usr/bin/env bash
# Wrapper Linux — delega para run-anvita-vps.mjs (cross-platform)
exec node "$(dirname "$0")/run-anvita-vps.mjs" "$@"

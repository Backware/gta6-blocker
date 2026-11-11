#!/bin/bash
# Double-click this file in Finder to build and install the Safari extension.
cd "$(dirname "$0")"
./scripts/build-safari.sh
echo
read -n 1 -s -r -p "Press any key to close this window…"

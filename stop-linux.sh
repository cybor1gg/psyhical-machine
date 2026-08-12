#!/usr/bin/env bash
# Stop this cabinet's processes (only the ones belonging to this folder).
cd "$(dirname "$0")"
HERE="$(pwd)"
echo "Stopping the cabinet..."
pkill -f "$HERE/runtime/mongod" 2>/dev/null
pkill -f "node server.js" 2>/dev/null
sleep 1
echo "Stopped."

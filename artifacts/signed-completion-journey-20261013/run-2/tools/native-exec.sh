#!/bin/sh
# Run-2: exec the installed native CLI inside the owned scope. The room capability is read from the
# private room file here, so the command line systemd records for the scope never carries it.
# The installed CLI accepts the token only as --room-token (server/native-participant.js:480,529):
# the node process argv still contains it; there is no file or environment option.
set -eu
room_file=$1; shift
room=$(/usr/bin/node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).roomId)' "$room_file")
token=$(/usr/bin/node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token)' "$room_file")
exec /usr/bin/node server/native-participant.js "$@" --room "$room" --room-token "$token"

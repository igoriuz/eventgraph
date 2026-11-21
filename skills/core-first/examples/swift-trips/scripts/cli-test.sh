#!/bin/sh
# A flow as a sequence of CLI calls, the way an agent drives it.
set -eu
swift build -q
store=$(mktemp -d)/store.sqlite
trip() { .build/debug/trip "$@" --store "$store" --json; }

trip create-trip --id rome --name Rome --budget 1000
trip add-expense --trip rome --amount 1500 | grep -q budgetWarned
trip trip-balance --trip rome | grep -q '"warned":true'

set +e
trip add-expense --trip nowhere --amount 100 | grep -q NO_TRIP
status=$?
trip add-expense --trip nowhere --amount 100 >/dev/null
code=$?
set -e
[ "$status" -eq 0 ] && [ "$code" -eq 2 ]
echo "cli flow ok"

# Swift recipe (Apple only, device authority)

A compiled, tested example lives in `../examples/swift-trips`: `swift build`,
`swift test` and `scripts/cli-test.sh` pass, and `eventgraph check` and
`eventgraph verify` are clean on its model. Copy from it rather than from memory.
Verified 2026-11-16 with Swift 6.4, GRDB 7, swift-argument-parser 1.5.

## Layout

```
Package.swift
Sources/
  TripCore/        library: the core — no SwiftUI, no ArgumentParser
    Ports.swift      Clock, IDs (and one protocol per service)
    Store.swift      GRDB migrations; aggregates are tables
    Contract.swift   Command, Event, Rejection, Outcome
    Core.swift       handle(command): write in one transaction, then policies
    Handlers.swift   one function per command
    Policies.swift   event in, commands out; reads only
    ReadModels.swift one type per read-model: fetch + observe
  TripCLI/         executable "trip": one subcommand per command and read-model
  TripUI/          the SwiftUI shell (the Xcode app target in a real project)
Tests/TripCoreTests/
scripts/cli-test.sh  a flow as a sequence of CLI calls
eventgraph/          the model; src pointers resolve from the repo root
```

The app target in Xcode depends on the `TripCore` product. Keep the core a
SwiftPM package even inside an Xcode project: it builds and tests without a
simulator, and the CLI links it directly.

## The interface, one place

```swift
public enum Command: Sendable, Equatable {
    case createTrip(id: String, name: String, budgetCents: Int)
    case addExpense(tripId: String, amountCents: Int)
    case warnBudget(tripId: String)
}
public enum Event: Sendable, Equatable, Encodable { case tripCreated(tripId: String) /* … */ }
public enum Rejection: String, Error, Sendable, Equatable, Encodable {
    case noTrip = "NO_TRIP"          // raw value = the code in the model's rejects
    case notPositive = "NOT_POSITIVE"
}
public enum Outcome: Sendable, Equatable { case done([Event]); case rejected(Rejection) }
```

One case per command, event and code in the model. `verify` finds `.noTrip` in
a screen as `NO_TRIP`, so cases keep Swift naming.

## Handling a command

`Core.handle` writes in one `store.write` transaction; a handler throws a
`Rejection` to refuse, and any other error is a real failure. Then each event
goes through `Policies.react` (in a read), and each command a policy returns is
handled the same way. A refused policy command does not undo the first one.

```swift
static func addExpense(tripId: String, amountCents: Int, id: String, at: Date, in db: Database) throws -> [Event] {
    guard amountCents > 0 else { throw Rejection.notPositive }      // invariant
    guard try tripExists(tripId, in: db) else { throw Rejection.noTrip }
    try db.execute(sql: "INSERT INTO expense …", arguments: [id, tripId, amountCents, at])
    return [.expenseAdded(tripId: tripId, amountCents: amountCents)]
}
```

Time and IDs come in as arguments from the ports — never `Date()` or `UUID()`
inside a handler. A policy that may run twice is made idempotent in the handler
it calls (`INSERT OR IGNORE`, returning no event when nothing changed).

## Read-models

A struct with `static func fetch(_ db: Database, …)` (one SQL query) and
`static func observe(…) -> ValueObservation` for screens. Screens subscribe
with `for try await value in X.observe(…).values(in: core.store)` inside
`.task`, so they never hold a stale copy and need no refresh after a command.

## Services

An outside system is a protocol in `Ports.swift` passed to `Core.init`, with a
fake in tests and a local or fake implementation in the CLI. The handler maps
its failure to a `Rejection` (or returns a failure event). In the model: a
`service` node and a `calls` edge from the command.

## CLI

swift-argument-parser, `AsyncParsableCommand`. Every subcommand:

- `static let configuration = CommandConfiguration(commandName: "add-expense")`
  — the literal is what `eventgraph verify` looks for; a name derived from the
  type is not found.
- `@OptionGroup var global: Global` with `--store` (default
  `.trip/store.sqlite`) and `--json`.
- Prints the events (`{"events": […]}`) or `{"rejected": "CODE"}` and exits 2.

## Tests

Swift Testing against an in-memory store (`Store.open(path: nil)`) with a
fixed clock and counting IDs:

- the happy path, asserting the events and the read-model afterwards;
- one parameterised test over every code in `rejects`;
- per policy: the first command's outcome contains the second command's events,
  and running it again does not repeat them.

`scripts/cli-test.sh` runs one flow through the built binary with a temporary
store — the same calls an agent makes.

## Model pointers

`src:` on each command, aggregate, read-model and policy points at the core
file; the screen at its SwiftUI file; the `cli` surface at the CLI file. Run
`eventgraph check` and `eventgraph verify` from the repo root.

## Checks to wire

```sh
swift build && swift test && ./scripts/cli-test.sh \
  && npx -y eventgraph-cli@0.5 check && npx -y eventgraph-cli@0.5 verify
```

Use the eventgraph version that has `service`, surface callers and CLI name
checks (0.4.0 or later); on 0.3.0 `verify` misses screens and `.camelCase`
codes.

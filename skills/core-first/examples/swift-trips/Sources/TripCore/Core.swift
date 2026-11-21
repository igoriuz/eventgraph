import Foundation
import GRDB

/// Takes a command, checks it, writes in one transaction, then lets policies
/// react to what happened. The only entry point for changing state.
public final class Core: Sendable {
    public let store: any DatabaseWriter
    let clock: any Clock
    let ids: any IDs

    public init(store: any DatabaseWriter, clock: any Clock = SystemClock(), ids: any IDs = RandomIDs()) {
        self.store = store
        self.clock = clock
        self.ids = ids
    }

    public func handle(_ command: Command) async throws -> Outcome {
        let events: [Event]
        do {
            events = try await store.write { db in try self.apply(command, in: db) }
        } catch let rejection as Rejection {
            return .rejected(rejection)
        }

        // Policies: the only way one flow sets off another.
        var all = events
        for event in events {
            let next = try await store.read { db in try Policies.react(to: event, in: db) }
            for command in next {
                // A policy's command is refused on its own; that does not undo
                // the first command, which has already happened.
                if case .done(let more) = try await handle(command) { all += more }
            }
        }
        return .done(all)
    }

    private func apply(_ command: Command, in db: Database) throws -> [Event] {
        switch command {
        case let .createTrip(id, name, budgetCents):
            return try Handlers.createTrip(id: id, name: name, budgetCents: budgetCents, in: db)
        case let .addExpense(tripId, amountCents):
            return try Handlers.addExpense(
                tripId: tripId, amountCents: amountCents, id: ids.next(), at: clock.now(), in: db)
        case let .warnBudget(tripId):
            return try Handlers.warnBudget(tripId: tripId, at: clock.now(), in: db)
        }
    }
}

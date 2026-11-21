import GRDB

/// Event in, commands out. Reads read-models, never writes.
enum Policies {
    static func react(to event: Event, in db: Database) throws -> [Command] {
        switch event {
        case let .expenseAdded(tripId, _):
            return try budgetWatch(tripId: tripId, in: db)
        case .tripCreated, .budgetWarned:
            return []
        }
    }

    /// budget-watch: spending past the budget warns once.
    static func budgetWatch(tripId: String, in db: Database) throws -> [Command] {
        guard let balance = try TripBalance.fetch(db, tripId: tripId), balance.overBudget, !balance.warned else {
            return []
        }
        return [.warnBudget(tripId: tripId)]
    }
}

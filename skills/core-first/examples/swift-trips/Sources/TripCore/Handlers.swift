import Foundation
import GRDB

/// One function per command: load, check invariants, write, return events.
enum Handlers {
    static func createTrip(id: String, name: String, budgetCents: Int, in db: Database) throws -> [Event] {
        guard budgetCents > 0 else { throw Rejection.notPositive }
        guard try !tripExists(id, in: db) else { throw Rejection.tripExists }
        try db.execute(
            sql: "INSERT INTO trip (id, name, budgetCents) VALUES (?, ?, ?)",
            arguments: [id, name, budgetCents])
        return [.tripCreated(tripId: id)]
    }

    static func addExpense(tripId: String, amountCents: Int, id: String, at: Date, in db: Database) throws -> [Event] {
        guard amountCents > 0 else { throw Rejection.notPositive }
        guard try tripExists(tripId, in: db) else { throw Rejection.noTrip }
        try db.execute(
            sql: "INSERT INTO expense (id, tripId, amountCents, spentAt) VALUES (?, ?, ?, ?)",
            arguments: [id, tripId, amountCents, at])
        return [.expenseAdded(tripId: tripId, amountCents: amountCents)]
    }

    /// Idempotent: a second warning for the same trip changes nothing.
    static func warnBudget(tripId: String, at: Date, in db: Database) throws -> [Event] {
        guard try tripExists(tripId, in: db) else { throw Rejection.noTrip }
        try db.execute(
            sql: "INSERT OR IGNORE INTO budgetWarning (tripId, warnedAt) VALUES (?, ?)",
            arguments: [tripId, at])
        return db.changesCount > 0 ? [.budgetWarned(tripId: tripId)] : []
    }

    private static func tripExists(_ id: String, in db: Database) throws -> Bool {
        try Bool.fetchOne(db, sql: "SELECT EXISTS (SELECT 1 FROM trip WHERE id = ?)", arguments: [id]) ?? false
    }
}

import GRDB

/// trip-balance: a query over the store, so it is never stale.
public struct TripBalance: Sendable, Equatable, Encodable {
    public var tripId: String
    public var name: String
    public var budgetCents: Int
    public var spentCents: Int
    public var warned: Bool

    public var overBudget: Bool { spentCents > budgetCents }

    public static func fetch(_ db: Database, tripId: String) throws -> TripBalance? {
        let sql = """
            SELECT t.id, t.name, t.budgetCents,
                   COALESCE((SELECT SUM(amountCents) FROM expense WHERE tripId = t.id), 0) AS spent,
                   EXISTS (SELECT 1 FROM budgetWarning WHERE tripId = t.id) AS warned
            FROM trip t WHERE t.id = ?
            """
        guard let row = try Row.fetchOne(db, sql: sql, arguments: [tripId]) else { return nil }
        return TripBalance(
            tripId: row["id"], name: row["name"], budgetCents: row["budgetCents"],
            spentCents: row["spent"], warned: row["warned"])
    }

    /// What a screen subscribes to: emits again whenever a table it reads changes.
    public static func observe(tripId: String) -> ValueObservation<ValueReducers.Fetch<TripBalance?>> {
        ValueObservation.tracking { db in try fetch(db, tripId: tripId) }
    }
}

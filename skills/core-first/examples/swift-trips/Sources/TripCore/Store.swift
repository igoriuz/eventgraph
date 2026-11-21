import GRDB

/// The one store. Aggregates are tables; read-models are queries over them.
public enum Store {
    /// `path == nil` opens an in-memory store, for tests.
    public static func open(path: String?) throws -> DatabaseQueue {
        let queue = try path.map { try DatabaseQueue(path: $0) } ?? DatabaseQueue()
        try migrator.migrate(queue)
        return queue
    }

    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1") { db in
            try db.create(table: "trip") { t in
                t.primaryKey("id", .text)
                t.column("name", .text).notNull()
                t.column("budgetCents", .integer).notNull()
            }
            try db.create(table: "expense") { t in
                t.primaryKey("id", .text)
                t.belongsTo("trip").notNull()
                t.column("amountCents", .integer).notNull()
                t.column("spentAt", .datetime).notNull()
            }
            try db.create(table: "budgetWarning") { t in
                t.primaryKey("tripId", .text).references("trip")
                t.column("warnedAt", .datetime).notNull()
            }
        }
        return migrator
    }
}

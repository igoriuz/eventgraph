import Foundation

/// Commands, events and refusals: the core's whole interface.
/// One case per command node in the model, one per event node,
/// one per code in a command's `rejects`.
public enum Command: Sendable, Equatable {
    case createTrip(id: String, name: String, budgetCents: Int)
    case addExpense(tripId: String, amountCents: Int)
    case warnBudget(tripId: String)
}

public enum Event: Sendable, Equatable, Encodable {
    case tripCreated(tripId: String)
    case expenseAdded(tripId: String, amountCents: Int)
    case budgetWarned(tripId: String)
}

public enum Rejection: String, Error, Sendable, Equatable, Encodable {
    case noTrip = "NO_TRIP"
    case notPositive = "NOT_POSITIVE"
    case tripExists = "TRIP_EXISTS"
}

public enum Outcome: Sendable, Equatable {
    case done([Event])
    case rejected(Rejection)
}

import Foundation
import Testing
@testable import TripCore

struct FixedClock: Clock {
    func now() -> Date { Date(timeIntervalSince1970: 0) }
}

final class CountingIDs: IDs, @unchecked Sendable {
    private var n = 0
    func next() -> String { n += 1; return "e\(n)" }
}

func makeCore() throws -> Core {
    Core(store: try Store.open(path: nil), clock: FixedClock(), ids: CountingIDs())
}

@Test func addingAnExpenseUpdatesTheBalance() async throws {
    let core = try makeCore()
    _ = try await core.handle(.createTrip(id: "rome", name: "Rome", budgetCents: 10_000))

    #expect(try await core.handle(.addExpense(tripId: "rome", amountCents: 2_500))
        == .done([.expenseAdded(tripId: "rome", amountCents: 2_500)]))
    let balance = try await core.store.read { try TripBalance.fetch($0, tripId: "rome") }
    #expect(balance?.spentCents == 2_500)
}

@Test(arguments: [
    (Command.addExpense(tripId: "nowhere", amountCents: 100), Rejection.noTrip),
    (Command.addExpense(tripId: "rome", amountCents: 0), Rejection.notPositive),
])
func refusals(command: Command, code: Rejection) async throws {
    let core = try makeCore()
    _ = try await core.handle(.createTrip(id: "rome", name: "Rome", budgetCents: 10_000))
    #expect(try await core.handle(command) == .rejected(code))
}

/// The policy: crossing the budget sets off warn-budget, once.
@Test func crossingTheBudgetWarnsOnce() async throws {
    let core = try makeCore()
    _ = try await core.handle(.createTrip(id: "rome", name: "Rome", budgetCents: 1_000))

    let first = try await core.handle(.addExpense(tripId: "rome", amountCents: 1_500))
    #expect(first == .done([.expenseAdded(tripId: "rome", amountCents: 1_500), .budgetWarned(tripId: "rome")]))

    let second = try await core.handle(.addExpense(tripId: "rome", amountCents: 100))
    #expect(second == .done([.expenseAdded(tripId: "rome", amountCents: 100)]))
}

import GRDB
import SwiftUI
import TripCore

/// A shell: shows a read-model, offers a command, keeps only view state.
public struct TripScreen: View {
    let core: Core
    let tripId: String

    @State private var balance: TripBalance?
    @State private var amountText = ""        // view state: a draft, not domain state
    @State private var message: String?

    public init(core: Core, tripId: String) {
        self.core = core
        self.tripId = tripId
    }

    public var body: some View {
        Form {
            if let balance {
                LabeledContent(balance.name, value: "\(balance.spentCents) / \(balance.budgetCents)")
                if balance.overBudget { Text("Over budget").foregroundStyle(.red) }
            }
            TextField("Amount (cents)", text: $amountText)
            Button("Add expense") { Task { await add() } }
            if let message { Text(message) }
        }
        .task {
            // trip-balance, live: re-emits whenever expense or budgetWarning changes.
            do {
                for try await value in TripBalance.observe(tripId: tripId).values(in: core.store) {
                    balance = value
                }
            } catch {
                message = "Could not load the trip."
            }
        }
    }

    private func add() async {
        guard let cents = Int(amountText) else { message = "Enter an amount."; return }
        do {
            switch try await core.handle(.addExpense(tripId: tripId, amountCents: cents)) {
            case .done:
                amountText = ""
                message = nil
            case .rejected(.notPositive):
                message = "The amount must be more than zero."
            case .rejected(.noTrip):
                message = "This trip no longer exists."
            case .rejected(.tripExists):
                break // not a code add-expense answers with
            }
        } catch {
            message = "Something went wrong. Try again."
        }
    }
}

import ArgumentParser
import Foundation
import TripCore

@main
struct TripCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "trip",
        subcommands: [CreateTrip.self, AddExpense.self, ShowTripBalance.self])
}

struct Global: ParsableArguments {
    @Option(help: "Store file kept between calls") var store = ".trip/store.sqlite"
    @Flag(help: "Machine-readable output") var json = false

    func core() throws -> Core {
        let url = URL(fileURLWithPath: store)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        return Core(store: try Store.open(path: store))
    }
}

/// Exit 0 done, 2 refused with {"rejected": CODE}, 1 anything else.
func report(_ outcome: Outcome, json: Bool) throws {
    switch outcome {
    case .done(let events):
        print(json ? try encode(["events": events]) : "ok (\(events.count) event(s))")
    case .rejected(let rejection):
        print(json ? try encode(["rejected": rejection]) : "refused: \(rejection.rawValue)")
        throw ExitCode(2)
    }
}

func encode<T: Encodable>(_ value: T) throws -> String {
    String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
}

struct CreateTrip: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "create-trip")
    @OptionGroup var global: Global
    @Option var id: String
    @Option var name: String
    @Option(help: "Budget in cents") var budget: Int

    func run() async throws {
        try report(await global.core().handle(.createTrip(id: id, name: name, budgetCents: budget)), json: global.json)
    }
}

struct AddExpense: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "add-expense")
    @OptionGroup var global: Global
    @Option var trip: String
    @Option(help: "Amount in cents") var amount: Int

    func run() async throws {
        try report(await global.core().handle(.addExpense(tripId: trip, amountCents: amount)), json: global.json)
    }
}

struct ShowTripBalance: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "trip-balance")
    @OptionGroup var global: Global
    @Option var trip: String

    func run() async throws {
        let core = try global.core()
        guard let balance = try await core.store.read({ db in try TripBalance.fetch(db, tripId: trip) }) else {
            print(global.json ? try encode(["rejected": Rejection.noTrip]) : "refused: NO_TRIP")
            throw ExitCode(2)
        }
        print(global.json ? try encode(balance) : "\(balance.name): \(balance.spentCents)/\(balance.budgetCents)")
    }
}

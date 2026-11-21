import Foundation

/// Everything the core needs from outside comes in through a port.
/// The app passes the real ones, tests and the CLI pass fakes or locals.
public protocol Clock: Sendable {
    func now() -> Date
}

public protocol IDs: Sendable {
    func next() -> String
}

public struct SystemClock: Clock {
    public init() {}
    public func now() -> Date { Date() }
}

public struct RandomIDs: IDs {
    public init() {}
    public func next() -> String { UUID().uuidString }
}

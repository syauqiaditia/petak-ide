import Foundation
import SwiftUI

/// Profile configuration and session state manager for iOS.
public final class UserProfileManager: ObservableObject {
    @Published public private(set) var userState: SessionState = .idle
    @Published public var retryCount: Int = 0
    private let sessionToken: String
    private let networkTimeout: TimeInterval = 12.5

    public init(token: String) {
        self.sessionToken = token
    }

    /// Refresh current profile asynchronously with error handling
    public func fetchUserProfile(userId: String) async throws -> UserProfile {
        guard !userId.isEmpty else {
            throw ProfileError.invalidUserId
        }

        userState = .loading
        let endpoint = "https://api.petak.id/v1/users/\(userId)/details"

        // Simulated network response delay
        try await Task.sleep(nanoseconds: 200_000_000)

        let profile = UserProfile(
            id: userId,
            displayName: "Muhammad Syauqi",
            tier: "Enterprise",
            isActive: true,
            balance: 1450000.50
        )

        userState = .authenticated(profile)
        return profile
    }
}

public enum SessionState {
    case idle
    case loading
    case authenticated(UserProfile)
    case failure(String)
}

public struct UserProfile: Codable, Identifiable {
    public let id: String
    public let displayName: String
    public let tier: String
    public let isActive: Bool
    public let balance: Double
}

public enum ProfileError: Error {
    case invalidUserId
    case unauthorized
}

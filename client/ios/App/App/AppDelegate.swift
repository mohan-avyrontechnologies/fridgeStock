import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// The notification category the server puts on a single-item reminder (aps.category). It is what makes the
    /// Used and Snooze buttons appear. Keep in step with IOS_ACTION_CATEGORY in server/src/services/fcmProvider.ts
    /// and with the action names in shared/src/enums.ts (PUSH_ACTIONS).
    private static let reminderCategory = "FOOD_ITEM"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Needs GoogleService-Info.plist from your Firebase project (see the README).
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
        }
        registerReminderActions()
        return true
    }

    /// Registers the Used and Snooze buttons. The tap comes back to the web app as a "pushNotificationActionPerformed"
    /// event with the action's id ("USED" or "SNOOZE"), which sends it to the API (platform/native/push.ts).
    /// They open the app (.foreground), so the web app is running to make that call.
    private func registerReminderActions() {
        let used = UNNotificationAction(identifier: "USED", title: "Used", options: [.foreground])
        let snooze = UNNotificationAction(identifier: "SNOOZE", title: "Snooze", options: [.foreground])
        let category = UNNotificationCategory(
            identifier: AppDelegate.reminderCategory,
            actions: [used, snooze],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources and save state.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused while the application was inactive.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Keep this call so the App API tracks url opens.
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {

        let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // MARK: - Push token (Firebase)

    /// The push plugin alone returns the raw APNs token. The server sends through Firebase, so hand Firebase the
    /// APNs token and give the plugin Firebase's token instead (this is the setup the Capacitor docs describe).
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token(completion: { (token, error) in
            if let error = error {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        })
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}

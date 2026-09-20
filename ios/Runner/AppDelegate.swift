import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let shareChannel = FlutterMethodChannel(name: "cue/shared", binaryMessenger: engineBridge.applicationRegistrar.messenger())
    shareChannel.setMethodCallHandler { call, result in
      guard call.method == "takeSharedFile" else { result(FlutterMethodNotImplemented); return }
      let defaults = UserDefaults(suiteName: "group.com.hanoo.cue")
      let path = defaults?.string(forKey: "pendingSharePath")
      defaults?.removeObject(forKey: "pendingSharePath")
      result(path)
    }
  }
}

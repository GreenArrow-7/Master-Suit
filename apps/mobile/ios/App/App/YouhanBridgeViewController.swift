import UIKit
import WebKit
import QuickLook
import CallKit
import Capacitor

/// Capacitor's bridge view controller plus two things the hosted YOUHAN ONE screens need
/// from iOS that Capacitor does not provide.
///
/// 1. A way back. The app has no browser chrome, so a document opened inside the web view
///    (a PDF shown inline, an image) would leave the person with no control to return.
///    Swiping back through the web view's own history restores that.
/// 2. Downloads. Payslips, lead documents and receipt evidence are served with
///    `Content-Disposition: attachment` or types WebKit cannot display. Without a download
///    delegate WKWebView drops those silently. They are now downloaded with the web view's
///    own session (so authorisation is unchanged — the server still decides) into a private
///    temporary folder and shown in Quick Look, which offers Share / Save to Files. The copy
///    is removed when the preview closes.
/// 3. CallWatch, the app's own plugin (below), registered with the bridge.
class YouhanBridgeViewController: CAPBridgeViewController {
    /// Strong reference: `WKWebView.navigationDelegate` is weak.
    private var downloadCoordinator: DownloadCoordinator?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(CallWatchPlugin())
        guard let webView = webView else { return }
        webView.allowsBackForwardNavigationGestures = true

        // Capacitor installed its own delegate while preparing the web view. Wrap it rather
        // than replace it: every navigation decision stays Capacitor's, and only the response
        // and download callbacks, which it does not implement, are handled here.
        if let capacitorDelegate = webView.navigationDelegate {
            let coordinator = DownloadCoordinator(forwardingTo: capacitorDelegate, presenter: self)
            downloadCoordinator = coordinator
            webView.navigationDelegate = coordinator
        }
    }
}

/// CallWatch (M9-09): tells the page when a call the agent placed from the app has ended, so the
/// page can log it on the lead. `start({ key })` arms it for the next outgoing call and answers
/// `{ armed }`; one `callEnded` event follows with the key, when that call ends, or with
/// `timedOut` after 60 seconds with no call. A call coming in is let pass.
///
/// CXCallObserver needs no permission and sees no number. iOS suspends the app soon after the
/// call screen takes over, so a background task keeps it awake to see the answer (iOS grants
/// about 30 seconds); an answer learnt only when the call ends counts from the start. iOS brings
/// the app back when a call it started ends, so the end is seen as it happens.
@objc(CallWatchPlugin)
public class CallWatchPlugin: CAPPlugin, CAPBridgedPlugin, CXCallObserverDelegate {
    public let identifier = "CallWatchPlugin"
    public let jsName = "CallWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]
    private let observer = CXCallObserver()
    private var key: String?
    private var callID: UUID?
    private var startedAt: Date?
    private var connectedAt: Date?
    private var timeout: DispatchWorkItem?
    private var awake: UIBackgroundTaskIdentifier = .invalid

    override public func load() {
        observer.setDelegate(self, queue: .main)
    }

    @objc func start(_ call: CAPPluginCall) {
        let next = call.getString("key") ?? ""
        DispatchQueue.main.async {
            self.finish(timedOut: true) // a call still armed is replaced, and its page told
            self.key = next
            let timeout = DispatchWorkItem { [weak self] in self?.finish(timedOut: true) }
            self.timeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
            self.awake = UIApplication.shared.beginBackgroundTask { [weak self] in self?.sleep() }
            call.resolve(["armed": true])
        }
    }

    public func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
        guard key != nil else { return }
        if callID == nil {
            guard call.isOutgoing, !call.hasEnded else { return }
            callID = call.uuid
            startedAt = Date()
            timeout?.cancel()
        }
        guard call.uuid == callID else { return }
        if call.hasConnected, connectedAt == nil {
            connectedAt = call.hasEnded ? startedAt : Optional(Date())
        }
        if call.hasEnded { finish(timedOut: false) }
    }

    private func finish(timedOut: Bool) {
        guard let key = key else { return }
        let endedAt = Date()
        let ms: (Date?) -> Any = { date in date.map { Int64($0.timeIntervalSince1970 * 1000) as Any } ?? NSNull() }
        notifyListeners("callEnded", data: [
            "key": key,
            "timedOut": timedOut,
            "startedAt": ms(startedAt),
            "connectedAt": ms(connectedAt),
            "endedAt": ms(endedAt),
            "durationSeconds": connectedAt.map { Int(endedAt.timeIntervalSince($0)) } ?? 0,
            "connected": connectedAt != nil
        ])
        self.key = nil
        callID = nil
        startedAt = nil
        connectedAt = nil
        timeout?.cancel()
        timeout = nil
        sleep()
    }

    private func sleep() {
        guard awake != .invalid else { return }
        UIApplication.shared.endBackgroundTask(awake)
        awake = .invalid
    }
}

final class DownloadCoordinator: NSObject, WKNavigationDelegate, WKDownloadDelegate, QLPreviewControllerDataSource,
    QLPreviewControllerDelegate {
    private let forwardTarget: WKNavigationDelegate
    private weak var presenter: UIViewController?
    private var destinations: [ObjectIdentifier: URL] = [:]
    private var previewing: URL?

    init(forwardingTo target: WKNavigationDelegate, presenter: UIViewController) {
        forwardTarget = target
        self.presenter = presenter
    }

    // MARK: Forwarding everything this class does not implement to Capacitor's delegate

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || forwardTarget.responds(to: aSelector)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if !super.responds(to: aSelector), forwardTarget.responds(to: aSelector) {
            return forwardTarget
        }
        return super.forwardingTarget(for: aSelector)
    }

    // MARK: Turning attachments and undisplayable responses into downloads

    /// `<a download>` — the CSV exports build a `blob:` URL. Capacitor would hand a blob URL
    /// to `UIApplication.open` (it is not the server URL), which cannot open it, so the export
    /// did nothing. Every other navigation is still decided by Capacitor.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if forwardTarget.webView?(webView, decidePolicyFor: navigationAction, decisionHandler: decisionHandler) == nil {
            decisionHandler(.allow)
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        decisionHandler(Self.isDownload(navigationResponse) ? .download : .allow)
    }

    static func isDownload(_ navigationResponse: WKNavigationResponse) -> Bool {
        guard navigationResponse.isForMainFrame else { return false }
        if !navigationResponse.canShowMIMEType { return true }
        guard let http = navigationResponse.response as? HTTPURLResponse,
              let disposition = http.value(forHTTPHeaderField: "Content-Disposition") else {
            return false
        }
        return disposition.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("attachment")
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: WKDownloadDelegate

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("youhan-downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            // Only the last path component: a server-suggested name never chooses the folder.
            let name = (suggestedFilename as NSString).lastPathComponent
            let destination = folder.appendingPathComponent(name.isEmpty ? "download" : name)
            destinations[ObjectIdentifier(download)] = destination
            completionHandler(destination)
        } catch {
            completionHandler(nil)
            showError()
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = destinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        DispatchQueue.main.async { [weak self] in self?.preview(url) }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = destinations.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        showError()
    }

    // MARK: Quick Look

    private func preview(_ url: URL) {
        guard let presenter = presenter else {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            return
        }
        previewing = url
        let controller = QLPreviewController()
        controller.dataSource = self
        controller.delegate = self
        presenter.present(controller, animated: true)
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewing == nil ? 0 : 1
    }

    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        (previewing ?? URL(fileURLWithPath: "/dev/null")) as NSURL
    }

    func previewControllerDidDismiss(_ controller: QLPreviewController) {
        if let url = previewing {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        previewing = nil
    }

    private func showError() {
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.presenter else { return }
            let alert = UIAlertController(
                title: "Download failed",
                message: "The file could not be downloaded. Check the connection and try again.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            presenter.present(alert, animated: true)
        }
    }
}

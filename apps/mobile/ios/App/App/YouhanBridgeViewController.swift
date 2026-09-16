import UIKit
import WebKit
import QuickLook
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
class YouhanBridgeViewController: CAPBridgeViewController {
    /// Strong reference: `WKWebView.navigationDelegate` is weak.
    private var downloadCoordinator: DownloadCoordinator?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
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

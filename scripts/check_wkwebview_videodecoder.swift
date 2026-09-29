import Foundation
import WebKit

class Delegate: NSObject, WKNavigationDelegate {
    var resultStr: String = "TIMEOUT"
    var finished = false

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let js = """
        return await (async () => {
            if (typeof VideoDecoder === 'undefined') {
                return JSON.stringify({ error: 'VideoDecoder is undefined in WKWebView' });
            }
            const codecs = [
                'avc1.42001f',
                'avc1.4d001f',
                'avc1.64002a',
                'vp8',
                'vp09.00.10.08',
                'av01.0.04M.08',
                'hvc1.1.6.L93.B0'
            ];
            const results = {};
            for (const c of codecs) {
                try {
                    const res = await VideoDecoder.isConfigSupported({ codec: c });
                    results[c] = res.supported;
                } catch (e) {
                    results[c] = 'error: ' + e.message;
                }
            }
            return JSON.stringify(results);
        })();
        """
        webView.callAsyncJavaScript(js, arguments: [:], in: nil, in: .defaultClient) { res in
            switch res {
            case .success(let val):
                if let str = val as? String {
                    self.resultStr = str
                } else {
                    self.resultStr = "\(String(describing: val))"
                }
            case .failure(let err):
                self.resultStr = "JS_ERROR: \(err.localizedDescription)"
            }
            self.finished = true
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        self.resultStr = "NAV_FAIL: \(error.localizedDescription)"
        self.finished = true
    }
}

let delegate = Delegate()
let config = WKWebViewConfiguration()
// Enable webgl and modern features if needed
config.preferences.setValue(true, forKey: "developerExtrasEnabled")

let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
webView.navigationDelegate = delegate
webView.loadHTMLString("<!DOCTYPE html><html><body><h1>VideoDecoder Check</h1></body></html>", baseURL: nil)

let runLoop = RunLoop.current
let timeoutDate = Date(timeIntervalSinceNow: 10.0)
while !delegate.finished && runLoop.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1)) {
    if Date() > timeoutDate {
        break
    }
}

print("FINAL_WKWEBVIEW_RESULT: " + delegate.resultStr)

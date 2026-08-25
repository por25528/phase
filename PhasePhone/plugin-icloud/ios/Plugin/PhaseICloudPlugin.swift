import Capacitor
import Foundation

/// The Capacitor bridge. Deliberately thin: argument unwrapping, call
/// resolution, and forwarding the change notification. All file behaviour lives
/// in `PhaseICloud`.
///
/// Capacitor runs these methods on a background queue, which is required —
/// `PhaseICloud` blocks on the ubiquity container.
@objc(PhaseICloudPlugin)
public class PhaseICloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhaseICloudPlugin"
    public let jsName = "PhaseICloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readStateFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readJournal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendOp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rewriteJournal", returnType: CAPPluginReturnPromise),
    ]

    private let icloud = PhaseICloud()

    override public func load() {
        icloud.startWatching { [weak self] in
            self?.notifyListeners("filesChanged", data: [:])
        }
    }

    @objc public func readStateFile(_ call: CAPPluginCall) {
        do {
            // A missing file is `null`, not a rejection: "the Mac has never
            // exported" is a state the phone renders.
            if let text = try icloud.readStateFile() {
                call.resolve(["text": text])
            } else {
                call.resolve(["text": NSNull()])
            }
        } catch {
            call.reject(error.localizedDescription, nil, error)
        }
    }

    @objc public func readJournal(_ call: CAPPluginCall) {
        do {
            call.resolve(["text": try icloud.readJournal()])
        } catch {
            call.reject(error.localizedDescription, nil, error)
        }
    }

    @objc public func appendOp(_ call: CAPPluginCall) {
        guard let line = call.getString("line") else {
            call.reject("appendOp requires a `line`")
            return
        }
        do {
            try icloud.appendOp(line: line)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription, nil, error)
        }
    }

    @objc public func rewriteJournal(_ call: CAPPluginCall) {
        guard let text = call.getString("text") else {
            call.reject("rewriteJournal requires a `text`")
            return
        }
        do {
            try icloud.rewriteJournal(text: text)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription, nil, error)
        }
    }
}

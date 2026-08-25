import Foundation

/// Errors this layer raises. Absence is never one of them: a missing container,
/// a missing folder or a missing `state.json` all mean "the Mac has not synced
/// yet", which is a state the phone renders, not a failure it reports.
enum PhaseICloudError: LocalizedError {
    case containerUnavailable
    case io(String)

    var errorDescription: String? {
        switch self {
        case .containerUnavailable:
            return "iCloud Drive is not available for this app. Check that iCloud Documents is enabled in Settings."
        case .io(let message):
            return message
        }
    }
}

/// All file access for the PhasePhone sync pair, inside the app's iCloud
/// container:
///
///     <container>/Documents/Phase/state.json        — read only, Mac writes it
///     <container>/Documents/Phase/ops-phone.jsonl   — write only, Mac reads it
///
/// Every read and write goes through `NSFileCoordinator`, because the other
/// side of both files is a daemon that may be mid-sync. The journal is
/// read-modify-written whole on every append: the phone compacts it against the
/// Mac's high-water mark, so it is a handful of lines, and a whole-file
/// coordinated write is simpler to reason about than a file-handle seek.
///
/// Threading: `url(forUbiquityContainerIdentifier:)` blocks, sometimes for
/// seconds on first call. Capacitor dispatches plugin methods onto a background
/// queue, so calling it here is correct — but nothing in this file may be
/// invoked from the main thread. The one exception is `NSMetadataQuery`, which
/// needs a run loop and is therefore started on the main queue on purpose.
final class PhaseICloud: NSObject {
    static let folderName = "Phase"
    static let stateFileName = "state.json"
    static let journalFileName = "ops-phone.jsonl"

    /// How long a read will wait for iCloud to pull down a `state.json` it has
    /// only a placeholder for. Bounded on purpose: a slow download must degrade
    /// to "as of <older time>", never to a hung UI. The metadata query fires
    /// `filesChanged` when the download eventually lands.
    private static let downloadWaitSeconds = 3.0
    private static let downloadPollSeconds = 0.1

    private var query: NSMetadataQuery?
    private var onChange: (() -> Void)?

    // MARK: - Locations

    private var containerDocuments: URL? {
        FileManager.default
            .url(forUbiquityContainerIdentifier: nil)?
            .appendingPathComponent("Documents", isDirectory: true)
    }

    /// The `Phase/` folder, created on first use. `nil` when the device has no
    /// usable container — the caller turns that into "never synced".
    private func directory(createIfMissing: Bool) throws -> URL? {
        guard let documents = containerDocuments else { return nil }
        let dir = documents.appendingPathComponent(Self.folderName, isDirectory: true)
        if createIfMissing && !FileManager.default.fileExists(atPath: dir.path) {
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            } catch {
                throw PhaseICloudError.io("Could not create \(dir.path): \(error.localizedDescription)")
            }
        }
        return dir
    }

    // MARK: - Reads

    /// The canonical state file, or `nil` when it does not exist yet.
    func readStateFile() throws -> String? {
        guard let dir = try directory(createIfMissing: true) else { return nil }
        return try coordinatedRead(at: dir.appendingPathComponent(Self.stateFileName))
    }

    /// The phone's journal; empty string when the file does not exist yet.
    func readJournal() throws -> String {
        guard let dir = try directory(createIfMissing: true) else { return "" }
        return try coordinatedRead(at: dir.appendingPathComponent(Self.journalFileName)) ?? ""
    }

    // MARK: - Writes

    /// Append one serialized op, newline-terminated. Tolerates a journal whose
    /// last line lost its newline (a truncated iCloud sync) by re-adding it, so
    /// two ops can never end up merged onto one unparseable line.
    func appendOp(line: String) throws {
        let op = line.trimmingCharacters(in: .newlines)
        guard !op.isEmpty else { return }
        try modifyJournal { existing in
            var text = existing ?? ""
            if !text.isEmpty && !text.hasSuffix("\n") { text += "\n" }
            return text + op + "\n"
        }
    }

    /// Replace the journal wholesale — the phone's compaction path.
    func rewriteJournal(text: String) throws {
        try modifyJournal { _ in text }
    }

    private func modifyJournal(_ transform: (String?) -> String) throws {
        guard let dir = try directory(createIfMissing: true) else {
            throw PhaseICloudError.containerUnavailable
        }
        let url = dir.appendingPathComponent(Self.journalFileName)

        var thrown: Error?
        var coordinationError: NSError?
        // `.forReplacing`: the write below is atomic (temp file + rename), and
        // that is what the coordinator needs to be told to expect.
        NSFileCoordinator(filePresenter: nil)
            .coordinate(writingItemAt: url, options: [.forReplacing], error: &coordinationError) { writeURL in
                do {
                    let existing = FileManager.default.fileExists(atPath: writeURL.path)
                        ? try String(contentsOf: writeURL, encoding: .utf8)
                        : nil
                    try transform(existing).write(to: writeURL, atomically: true, encoding: .utf8)
                } catch {
                    thrown = error
                }
            }

        if let coordinationError {
            throw PhaseICloudError.io("Could not coordinate a write to \(url.lastPathComponent): \(coordinationError.localizedDescription)")
        }
        if let thrown {
            throw PhaseICloudError.io("Could not write \(url.lastPathComponent): \(thrown.localizedDescription)")
        }
    }

    // MARK: - Coordinated read

    private func coordinatedRead(at url: URL) throws -> String? {
        waitForDownloadIfNeeded(at: url)

        var text: String?
        var thrown: Error?
        var coordinationError: NSError?
        NSFileCoordinator(filePresenter: nil)
            .coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordinationError) { readURL in
                guard FileManager.default.fileExists(atPath: readURL.path) else { return }
                do {
                    text = try String(contentsOf: readURL, encoding: .utf8)
                } catch {
                    thrown = error
                }
            }

        // Coordinating a read of a file that isn't there fails, and that is the
        // normal "never synced" case — not something to report.
        if coordinationError != nil && !FileManager.default.fileExists(atPath: url.path) { return nil }
        if let coordinationError {
            throw PhaseICloudError.io("Could not coordinate a read of \(url.lastPathComponent): \(coordinationError.localizedDescription)")
        }
        if let thrown {
            throw PhaseICloudError.io("Could not read \(url.lastPathComponent): \(thrown.localizedDescription)")
        }
        return text
    }

    /// iCloud may hold only a placeholder for a file the Mac just wrote. Ask for
    /// the real bytes and wait a bounded moment; give up quietly if they don't
    /// arrive, leaving the caller with the previous good copy.
    private func waitForDownloadIfNeeded(at url: URL) {
        guard !isDownloaded(url) else { return }
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)

        let deadline = Date().addingTimeInterval(Self.downloadWaitSeconds)
        while Date() < deadline {
            if isDownloaded(url) { return }
            Thread.sleep(forTimeInterval: Self.downloadPollSeconds)
        }
    }

    private func isDownloaded(_ url: URL) -> Bool {
        let status = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey])
            .ubiquitousItemDownloadingStatus
        // No status at all means the item is not a ubiquitous placeholder — it
        // is either an ordinary local file or absent, and either way there is
        // nothing to wait for.
        guard let status else { return true }
        return status == .current
    }

    // MARK: - Change notification

    /// Fire `handler` whenever iCloud lands a change to either file. Idempotent:
    /// calling it again just re-points the handler.
    func startWatching(_ handler: @escaping () -> Void) {
        onChange = handler
        guard query == nil else { return }

        let query = NSMetadataQuery()
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(
            format: "%K == %@ OR %K == %@",
            NSMetadataItemFSNameKey, Self.stateFileName,
            NSMetadataItemFSNameKey, Self.journalFileName
        )
        self.query = query

        NotificationCenter.default.addObserver(
            self, selector: #selector(queryChanged),
            name: .NSMetadataQueryDidFinishGathering, object: query
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(queryChanged),
            name: .NSMetadataQueryDidUpdate, object: query
        )

        // NSMetadataQuery needs a run loop to deliver on.
        DispatchQueue.main.async { query.start() }
    }

    func stopWatching() {
        onChange = nil
        guard let query else { return }
        self.query = nil
        NotificationCenter.default.removeObserver(self, name: .NSMetadataQueryDidFinishGathering, object: query)
        NotificationCenter.default.removeObserver(self, name: .NSMetadataQueryDidUpdate, object: query)
        DispatchQueue.main.async { query.stop() }
    }

    @objc private func queryChanged(_ notification: Notification) {
        onChange?()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

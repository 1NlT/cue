import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let group = "group.com.hanoo.cue"
  private let message = UILabel()
  private let done = UIButton(type: .system)

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    message.text = "Cue로 전달하는 중…"
    message.textAlignment = .center
    message.numberOfLines = 0
    message.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(message)
    done.setTitle("완료", for: .normal)
    done.isHidden = true
    done.addTarget(self, action: #selector(close), for: .touchUpInside)
    done.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(done)
    NSLayoutConstraint.activate([
      message.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      message.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      message.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      message.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      done.topAnchor.constraint(equalTo: message.bottomAnchor, constant: 20),
      done.centerXAnchor.constraint(equalTo: view.centerXAnchor)
    ])
    receive()
  }

  private func receive() {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
          let providers = extensionContext?.inputItems.compactMap({ $0 as? NSExtensionItem }).flatMap({ $0.attachments ?? [] }) else {
      message.text = "공유 파일을 읽을 수 없어요."
      return
    }
    let provider = providers.first { $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) || $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
    guard let provider else { message.text = "이미지 또는 PDF를 공유해 주세요."; return }
    let type = provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) ? UTType.pdf : UTType.image
    provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] source, error in
      guard let self, let source, error == nil else { DispatchQueue.main.async { self?.message.text = "파일을 받을 수 없어요." }; return }
      let ext = type == .pdf ? "pdf" : "jpg"
      let destination = container.appendingPathComponent("cue-shared-\(UUID().uuidString).\(ext)")
      do {
        if type == .pdf {
          try FileManager.default.copyItem(at: source, to: destination)
        } else {
          guard let data = UIImage(contentsOfFile: source.path)?.jpegData(compressionQuality: 0.8) else {
            throw NSError(domain: "CueShare", code: 1)
          }
          try data.write(to: destination, options: .atomic)
        }
        UserDefaults(suiteName: self.group)?.set(destination.path, forKey: "pendingSharePath")
        DispatchQueue.main.async {
          self.message.text = "전달했어요. Cue 앱을 열면 분석을 시작합니다."
          self.done.isHidden = false
        }
      } catch { DispatchQueue.main.async { self.message.text = "파일을 저장할 수 없어요." } }
    }
  }

  @objc private func close() {
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}

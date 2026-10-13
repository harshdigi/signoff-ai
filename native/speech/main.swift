// Signoff AI · written by harshdigi (https://github.com/harshdigi)
// SPDX-License-Identifier: FSL-1.1-ALv2

// signoff-speech: voice input for the chat box, with Apple's on-device speech recognition.
// - Listens to the microphone and prints one JSON line per event on stdout:
//   {"type":"ready"} | {"type":"partial","text":…} | {"type":"final","text":…} | {"type":"error","code":…,"message":…}
// - Stops when stdin closes or receives a line "stop"; then prints the final text and exits.
// - On-device only (requiresOnDeviceRecognition): audio never leaves the Mac. A language without an on-device model
//   is refused with code "no-on-device", not sent to Apple's servers.
// - Usage: signoff-speech [--locale en-IN]   (default: the Mac's current language)
//          signoff-speech --languages        one JSON line: [{"id":"en-IN","onDevice":true}, …] (no mic, no prompts)
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ event: [String: String]) {
  guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["type": "error", "code": code, "message": message])
  exit(1)
}

let args = CommandLine.arguments

if args.contains("--languages") {
  let list = SFSpeechRecognizer.supportedLocales().map(\.identifier).sorted().map { id -> [String: Any] in
    ["id": id, "onDevice": SFSpeechRecognizer(locale: Locale(identifier: id))?.supportsOnDeviceRecognition ?? false]
  }
  if let data = try? JSONSerialization.data(withJSONObject: list) { FileHandle.standardOutput.write(data + Data("\n".utf8)) }
  exit(0)
}
let localeId = args.firstIndex(of: "--locale").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
let locale = localeId.map { Locale(identifier: $0) } ?? Locale.current

guard let recognizer = SFSpeechRecognizer(locale: locale) else {
  fail("no-language", "Speech recognition does not support \(locale.identifier).")
}
guard recognizer.supportsOnDeviceRecognition else {
  fail("no-on-device", "No on-device speech model for \(locale.identifier). Download it in System Settings → Keyboard → Dictation, or pick another language.")
}

let engine = AVAudioEngine()
let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.requiresOnDeviceRecognition = true
request.addsPunctuation = true
var task: SFSpeechRecognitionTask?
var stopping = false

func finish() {
  if stopping { return }
  stopping = true
  engine.stop()
  engine.inputNode.removeTap(onBus: 0)
  request.endAudio()
  // The final result normally arrives within a moment; do not hang if it never does.
  DispatchQueue.main.asyncAfter(deadline: .now() + 3) { exit(0) }
}

func start() {
  let input = engine.inputNode
  let format = input.outputFormat(forBus: 0)
  input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
  engine.prepare()
  do { try engine.start() } catch { fail("mic", "Could not start the microphone: \(error.localizedDescription)") }
  task = recognizer.recognitionTask(with: request) { result, error in
    if let result {
      let text = result.bestTranscription.formattedString
      emit(["type": result.isFinal ? "final" : "partial", "text": text])
      if result.isFinal { exit(0) }
    }
    if let error {
      // After stop, "no speech" ends the task without a result: report an empty final, not an error.
      if stopping { emit(["type": "final", "text": ""]); exit(0) }
      fail("recognition", error.localizedDescription)
    }
  }
  emit(["type": "ready"])
}

// Stop on "stop" or when the app closes stdin.
DispatchQueue.global().async {
  while let line = readLine() {
    if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
  }
  DispatchQueue.main.async { finish() }
}

SFSpeechRecognizer.requestAuthorization { status in
  guard status == .authorized else {
    fail("speech-denied", "Speech recognition is off for Signoff AI. Turn it on in System Settings → Privacy & Security → Speech Recognition.")
  }
  AVCaptureDevice.requestAccess(for: .audio) { granted in
    guard granted else {
      fail("mic-denied", "The microphone is off for Signoff AI. Turn it on in System Settings → Privacy & Security → Microphone.")
    }
    DispatchQueue.main.async { start() }
  }
}

RunLoop.main.run()

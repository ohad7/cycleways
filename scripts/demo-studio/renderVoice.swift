#!/usr/bin/env swift
import AVFoundation
import Foundation

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}

func selectedVoice(language: String, requested: String?) -> AVSpeechSynthesisVoice? {
    if let requested, requested != "default" {
        return AVSpeechSynthesisVoice(identifier: requested)
    }
    return AVSpeechSynthesisVoice(language: language)
}

if CommandLine.arguments.contains("--check") {
    let language = argument("--language") ?? "he-IL"
    guard let voice = selectedVoice(language: language, requested: argument("--voice")) else {
        fputs("requested speech voice is unavailable\n", stderr)
        exit(1)
    }
    print("\(voice.name) (\(voice.identifier))")
    exit(0)
}

guard let output = argument("--output"), let text = argument("--text"), let language = argument("--language") else {
    fputs("usage: renderVoice.swift --output file.wav --text text --language he-IL [--voice id] [--rate 0.92]\n", stderr)
    exit(2)
}
let synthesizer = AVSpeechSynthesizer()
let utterance = AVSpeechUtterance(string: text)
guard let voice = selectedVoice(language: language, requested: argument("--voice")) else {
    fputs("requested speech voice is unavailable\n", stderr)
    exit(1)
}
utterance.voice = voice
if let rate = argument("--rate").flatMap(Float.init) {
    utterance.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(rate * AVSpeechUtteranceDefaultSpeechRate, AVSpeechUtteranceMaximumSpeechRate))
}
var audioFile: AVAudioFile?
var writeError: Error?
var finished = false
synthesizer.write(utterance) { buffer in
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { finished = true; return }
    do {
        if audioFile == nil {
            audioFile = try AVAudioFile(forWriting: URL(fileURLWithPath: output), settings: pcm.format.settings)
        }
        try audioFile?.write(from: pcm)
    } catch {
        writeError = error
        finished = true
    }
}
let deadline = Date().addingTimeInterval(60)
while !finished && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
}
if !finished {
    fputs("speech rendering timed out\n", stderr)
    exit(1)
}
if let error = writeError {
    fputs("speech rendering failed: \(error)\n", stderr)
    exit(1)
}

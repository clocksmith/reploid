import '../domain/chat.dart';

/// What the network reports, before repository projection.
final class NetworkSnapshot {
  NetworkSnapshot({
    required this.status,
    required List<Computer> computers,
    this.desktop,
  }) : computers = List.unmodifiable(computers);

  final NetworkStatus status;
  final List<Computer> computers;

  /// The paired desktop as the adapter knows it now.
  final Desktop? desktop;
}

final class CatalogModel {
  const CatalogModel({required this.id, required this.name});
  final String id;
  final String name;
}

final class PromptMessage {
  const PromptMessage(this.role, this.text);
  final TurnRole role;
  final String text;
}

/// Progress of one answer, in the order the requester contract fixes.
sealed class AnswerEvent {
  const AnswerEvent();
}

/// The recipient proved its signing identity. Nothing has been sent yet.
final class RecipientProven extends AnswerEvent {
  const RecipientProven(this.participantId);
  final String participantId;
}

/// The recipient admitted the request and the prompt has now left the device.
final class PromptSent extends AnswerEvent {
  const PromptSent();
}

final class AnswerChunk extends AnswerEvent {
  const AnswerChunk(this.text);
  final String text;
}

/// The final text, and whether the provider's signed receipt for exactly
/// this prompt and answer verified.
final class AnswerCompleted extends AnswerEvent {
  const AnswerCompleted(this.text, {required this.receiptVerified});
  final String text;
  final bool receiptVerified;
}

/// One request in flight. [events] ends after [AnswerCompleted], or with an
/// `AppFailure` error. [cancel] asks the recipient to stop; text already
/// received stays valid.
abstract interface class Answer {
  Stream<AnswerEvent> get events;
  Future<void> cancel();
}

/// The requester side of the Reploid network, bound to one signing identity
/// when the adapter is created. Implementations: the contract engine over
/// WebRTC, and an in-memory network for tests and the demo.
abstract interface class RequesterApi {
  List<CatalogModel> get catalog;
  Stream<NetworkSnapshot> watch();
  Future<void> open();
  Future<void> close();

  /// An answer from a contributor with [modelId], or, with
  /// [AnswerTarget.desktop], from the paired desktop and no one else.
  Answer ask({
    required String modelId,
    required List<PromptMessage> messages,
    AnswerTarget target = AnswerTarget.contributors,
  });

  DesktopInvite? readInvite(String link);

  /// Completes when the desktop's owner approved and the pairing is kept.
  /// [onAsked] runs once the code has gone to the proven desktop.
  Future<void> pair(String link, {void Function()? onAsked});
  Future<void> unpair();
}

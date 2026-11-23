import 'package:core/core.dart';

/// A model the network offers, with how many computers can answer now.
final class ModelOption {
  const ModelOption({
    required this.id,
    required this.name,
    this.readyComputers = 0,
    this.busyComputers = 0,
  });

  final String id;
  final String name;
  final int readyComputers;
  final int busyComputers;

  bool get available => readyComputers > 0;
}

/// A computer seen on the network. [participantId] is set only once that
/// computer has proven its signing identity on the current connection.
final class Computer {
  const Computer({
    required this.address,
    required this.modelId,
    required this.ready,
    required this.busy,
    this.participantId,
  });

  final String address;
  final String modelId;
  final bool ready;
  final bool busy;
  final String? participantId;
}

enum NetworkStatus { offline, connecting, online }

final class NetworkResource {
  NetworkResource({
    required this.sessionKey,
    required this.status,
    required List<ModelOption> models,
    required List<Computer> computers,
    required this.networkAnswersAllowed,
    this.failure,
  }) : models = List.unmodifiable(models),
       computers = List.unmodifiable(computers);

  final SessionKey sessionKey;
  final NetworkStatus status;
  final List<ModelOption> models;
  final List<Computer> computers;

  /// The standing permission to send prompts to other people's computers.
  final bool networkAnswersAllowed;
  final FailureKind? failure;
}

enum TurnRole { user, assistant }

/// Where an answer stands. Up to [admitting] the prompt has not left this
/// device; from [streaming] on, the named recipient has received it.
enum AnswerPhase {
  finding,
  verifying,
  admitting,
  streaming,
  complete,
  stopped,
  failed,
}

final class Turn {
  const Turn({
    required this.id,
    required this.role,
    required this.text,
    this.phase,
    this.attemptId,
    this.recipient,
    this.promptSent = false,
    this.receiptVerified = false,
    this.failure,
  });

  final String id;
  final TurnRole role;
  final String text;

  /// Set for assistant turns only.
  final AnswerPhase? phase;

  /// The execution attempt that produced this answer. Asking again keeps
  /// the conversation and the prompt but is a new attempt, and nothing
  /// from an earlier attempt can change a later one.
  final String? attemptId;

  /// The proven signing identity of the computer that answers this turn.
  final String? recipient;
  final bool promptSent;
  final bool receiptVerified;
  final FailureKind? failure;

  bool get inProgress =>
      phase != null &&
      phase != AnswerPhase.complete &&
      phase != AnswerPhase.stopped &&
      phase != AnswerPhase.failed;

  Turn copyWith({
    String? text,
    AnswerPhase? phase,
    String? recipient,
    bool? promptSent,
    bool? receiptVerified,
    FailureKind? failure,
  }) => Turn(
    id: id,
    role: role,
    text: text ?? this.text,
    phase: phase ?? this.phase,
    attemptId: attemptId,
    recipient: recipient ?? this.recipient,
    promptSent: promptSent ?? this.promptSent,
    receiptVerified: receiptVerified ?? this.receiptVerified,
    failure: failure ?? this.failure,
  );
}

final class Conversation {
  Conversation({
    required this.id,
    required this.title,
    required this.modelId,
    required List<Turn> turns,
  }) : turns = List.unmodifiable(turns);

  final String id;

  /// Empty until the first prompt; presentation supplies the fallback label.
  final String title;
  final String? modelId;
  final List<Turn> turns;

  bool get busy => turns.isNotEmpty && turns.last.inProgress;

  /// A stopped or failed last answer can be asked for again.
  bool get canRetry =>
      turns.length >= 2 &&
      turns.last.role == TurnRole.assistant &&
      (turns.last.phase == AnswerPhase.failed ||
          turns.last.phase == AnswerPhase.stopped);
}

final class ConversationResource {
  const ConversationResource({required this.sessionKey, this.conversation});

  final SessionKey sessionKey;

  /// Null when the conversation does not exist in this session.
  final Conversation? conversation;
}

final class ConversationListResource {
  ConversationListResource({
    required this.sessionKey,
    required List<Conversation> conversations,
  }) : conversations = List.unmodifiable(conversations);

  final SessionKey sessionKey;
  final List<Conversation> conversations;
}

/// The single authority for conversations and what the network offers, for
/// one session. Presentation never keeps a second writable copy.
abstract interface class ChatRepository {
  Stream<NetworkResource> watchNetwork();
  Future<void> reconnect();
  Future<void> setNetworkAnswersAllowed(bool allowed);

  Stream<ConversationListResource> watchList();
  Stream<ConversationResource> watch(String id);
  String create();
  void remove(String id);
  void selectModel(String id, String modelId);

  /// Adds the prompt and starts its answer. Completes when the answer ends;
  /// throws [AppFailure] for a prompt that was refused before any attempt.
  Future<void> send(String id, String text);
  Future<void> stop(String id);
  Future<void> retry(String id);
}

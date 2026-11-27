import 'dart:typed_data';

import 'package:core/core.dart';

import 'send_intent.dart';

export 'send_intent.dart';

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
    this.label,
    this.blocked = false,
  });

  final String address;
  final String modelId;
  final bool ready;
  final bool busy;
  final String? participantId;

  /// The name the person gave this computer on this device.
  final String? label;

  /// Blocked on this device: it never receives this device's prompts.
  final bool blocked;

  Computer withPreferences({String? label, required bool blocked}) => Computer(
    address: address,
    modelId: modelId,
    ready: ready,
    busy: busy,
    participantId: participantId,
    label: label,
    blocked: blocked,
  );
}

/// A blocked computer, shown even while it is not on the network.
final class BlockedComputer {
  const BlockedComputer({required this.id, this.label});
  final String id;
  final String? label;
}

/// A file chosen on the device, before it is read as text.
final class PickedFile {
  const PickedFile({required this.name, required this.bytes});
  final String name;
  final Uint8List bytes;
}

/// A text file waiting to go with the next prompt.
final class AttachedFile {
  const AttachedFile({
    required this.name,
    required this.text,
    required this.bytes,
  });
  final String name;
  final String text;
  final int bytes;
}

/// What a stored user message shows when files went with it.
final class TurnAttachments {
  const TurnAttachments({required this.question, required this.names});
  final String question;
  final List<String> names;
}

/// The system's file dialogs.
abstract interface class DocumentPicker {
  /// Empty when the person cancels.
  Future<List<PickedFile>> pickAttachments();
  Future<PickedFile?> pickDataFile();

  /// False when the person cancels.
  Future<bool> save(String name, String text);
}

enum Appearance { system, light, dark }

/// What asking about a lost answer found.
enum RecoverResult {
  /// The answer arrived and its signed receipt verified.
  answered,

  /// The computer signed that the request ended without an answer.
  ended,

  /// Unknown for now: it is offline, still working, or no longer has it.
  notYet,
}

/// What an import would add. Nothing has changed yet.
final class ImportPreview {
  const ImportPreview({
    required this.conversations,
    required this.conversationsSkipped,
    required this.names,
    required this.namesSkipped,
    required this.blocked,
    required this.blockedSkipped,
  });
  final int conversations;
  final int conversationsSkipped;
  final int names;
  final int namesSkipped;
  final int blocked;
  final int blockedSkipped;

  bool get empty => conversations + names + blocked == 0;
}

/// An exported file, and how many conversations could not be written.
final class DataExport {
  const DataExport({
    required this.text,
    required this.conversations,
    required this.omitted,
  });
  final String text;
  final int conversations;
  final int omitted;
}

enum NetworkStatus { offline, connecting, online }

/// Which network the app connects to; configurable at runtime in Settings
/// unless overridden for a specific build or test harness.
enum NetworkMode { demo, public, room }

final class NetworkPreference {
  const NetworkPreference({
    this.mode = NetworkMode.demo,
    this.signalingUrl = '',
    this.roomId = '',
    this.token = '',
    this.origin = '',
    this.rtcConfigUrl = '',
  });

  final NetworkMode mode;
  final String signalingUrl;
  final String roomId;
  final String token;
  final String origin;
  final String rtcConfigUrl;

  bool get isValid {
    if (mode != NetworkMode.room) return true;
    final uri = Uri.tryParse(signalingUrl.trim());
    return uri != null &&
        (uri.scheme == 'ws' || uri.scheme == 'wss') &&
        uri.host.isNotEmpty &&
        roomId.trim().isNotEmpty &&
        token.trim().length >= 32;
  }

  @override
  bool operator ==(Object other) =>
      other is NetworkPreference &&
      other.mode == mode &&
      other.signalingUrl == signalingUrl &&
      other.roomId == roomId &&
      other.token == token &&
      other.origin == origin &&
      other.rtcConfigUrl == rtcConfigUrl;

  @override
  int get hashCode =>
      Object.hash(mode, signalingUrl, roomId, token, origin, rtcConfigUrl);
}

/// Where an answer runs. The person chooses; the app never changes it.
enum AnswerTarget { contributors, desktop }

/// What a pairing link says before anything is sent, so the person can
/// check which desktop they are about to pair with.
final class DesktopInvite {
  const DesktopInvite({required this.participantId, required this.label});
  final String participantId;
  final String label;
}

enum DesktopStatus {
  /// Looking for the desktop; the pairing code has not been sent.
  finding,

  /// The code was sent to the proven desktop; its owner must approve.
  awaitingApproval,
  online,
  offline,
}

/// The person's own desktop, pinned by its signing identity. It is online
/// only while a connection has proven that identity; nothing else, such as
/// a name or what a computer says about itself, counts.
final class Desktop {
  const Desktop({
    required this.participantId,
    required this.label,
    required this.status,
    this.modelId,
  });
  final String participantId;
  final String label;
  final DesktopStatus status;

  /// The model the desktop is ready to answer with, if any.
  final String? modelId;

  bool get paired =>
      status == DesktopStatus.online || status == DesktopStatus.offline;
}

final class NetworkResource {
  NetworkResource({
    required this.sessionKey,
    required this.status,
    required List<ModelOption> models,
    required List<Computer> computers,
    required this.networkAnswersAllowed,
    this.desktop,
    this.pairingFailure,
    this.failure,
    List<BlockedComputer> blockedComputers = const [],
  }) : models = List.unmodifiable(models),
       computers = List.unmodifiable(computers),
       blockedComputers = List.unmodifiable(blockedComputers);

  final SessionKey sessionKey;
  final NetworkStatus status;
  final List<ModelOption> models;
  final List<Computer> computers;
  final List<BlockedComputer> blockedComputers;

  /// The standing permission to send prompts to other people's computers.
  final bool networkAnswersAllowed;

  /// The paired desktop, or one being paired; null when there is none.
  final Desktop? desktop;

  /// Why the last pairing attempt ended without a pairing.
  final FailureKind? pairingFailure;
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
    this.attachments,
    this.requestId,
    this.requestModelId,
    this.recoverable = false,
  });

  /// The wire request, once its prompt was sent.
  final String? requestId;

  /// The model that request named, which a desktop may choose.
  final String? requestModelId;

  /// The connection was lost with the prompt sent, so the recipient may
  /// still hold the answer.
  final bool recoverable;

  final String id;
  final TurnRole role;

  /// Exactly what was sent or received, including any attached files.
  final String text;

  /// Set on a user turn that carried files.
  final TurnAttachments? attachments;

  /// What the person wrote, without the attached files' text.
  String get shownText => attachments?.question ?? text;

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
    TurnAttachments? attachments,
    String? requestId,
    String? requestModelId,
    bool? recoverable,
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
    attachments: attachments ?? this.attachments,
    requestId: requestId ?? this.requestId,
    requestModelId: requestModelId ?? this.requestModelId,
    recoverable: recoverable ?? this.recoverable,
  );

  /// The answer, recovered from the recipient and verified.
  Turn recovered(String answer) => Turn(
    id: id,
    role: role,
    text: answer,
    phase: AnswerPhase.complete,
    attemptId: attemptId,
    recipient: recipient,
    promptSent: true,
    receiptVerified: true,
    requestId: requestId,
    requestModelId: requestModelId,
  );
}

final class Conversation {
  Conversation({
    required this.id,
    required this.title,
    required this.modelId,
    required List<Turn> turns,
    this.target = AnswerTarget.contributors,
    this.draft = '',
    this.nextRecipient,
    this.modelPinned = false,
    this.pinnedModelIdentity,
    this.heldSend,
    this.sendIntentRefusal,
    List<AttachedFile> draftFiles = const [],
  }) : turns = List.unmodifiable(turns),
       draftFiles = List.unmodifiable(draftFiles);

  final String id;

  /// Where this conversation's answers run.
  final AnswerTarget target;

  /// Empty until the first prompt; presentation supplies the fallback label.
  final String title;
  final String? modelId;
  final List<Turn> turns;

  /// Unsent prompt text kept for this conversation while the session lives.
  final String draft;

  /// The proven computer the next prompt would go to, when contributors
  /// answer. Null when none is ready or the best one is not yet proven.
  final String? nextRecipient;

  /// True when the person explicitly picked this conversation's model.
  final bool modelPinned;

  /// Exact sha256 weights identity of the pinned model, if any.
  final String? pinnedModelIdentity;

  /// Active Send-intent waiting up to 30s for a permitted route.
  final HeldSend? heldSend;

  /// Why the most recent held Send-intent was refused without dispatching.
  final SendIntentRefusal? sendIntentRefusal;

  /// Files waiting to go with the next prompt, for this session only.
  final List<AttachedFile> draftFiles;

  bool get busy =>
      heldSend != null || (turns.isNotEmpty && turns.last.inProgress);

  /// The last answer was lost in transit and its recipient can be asked.
  bool get canRecover {
    if (turns.isEmpty) return false;
    final last = turns.last;
    return last.role == TurnRole.assistant &&
        last.phase == AnswerPhase.failed &&
        last.recoverable &&
        last.promptSent &&
        last.requestId != null &&
        last.requestModelId != null &&
        last.recipient != null;
  }

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

  /// Reads a pairing link without sending anything; null when it is not one.
  DesktopInvite? readInvite(String link);

  /// Pairs with the desktop the link names. Completes once its owner has
  /// approved; throws [AppFailure] when it was not found, did not answer,
  /// or declined.
  Future<void> pair(String link);
  Future<void> unpair();
  void selectTarget(String id, AnswerTarget target);

  Stream<ConversationListResource> watchList();
  Stream<ConversationResource> watch(String id);
  String create();
  void remove(String id);
  void selectModel(String id, String modelId);
  void setDraft(String id, String text);

  /// Adds files to the next prompt. Throws [FailureKind.validation] and adds
  /// none when any is over the limits, of another type, or not UTF-8 text.
  void addAttachments(String id, List<PickedFile> files);
  void removeAttachment(String id, int index);

  /// An empty [name] removes the name.
  Future<void> renameComputer(String participantId, String name);
  Future<void> blockComputer(Computer computer);
  Future<void> unblockComputer(String id);

  Future<DataExport> exportData();

  /// Reads a data file and says what it would add, changing nothing.
  Future<ImportPreview> previewImport(String text);

  /// Applies the last preview. Nothing is sent, resumed or overwritten.
  Future<ImportPreview> confirmImport();
  void cancelImport();
  Future<void> flush();

  /// Adds the prompt and starts its answer. Completes when the answer ends;
  /// throws [AppFailure] for a prompt that was refused before any attempt.
  ///
  /// [disclosedRecipient] is the computer the screen named. If another
  /// would now be chosen this throws [FailureKind.conflict] and sends
  /// nothing, and the prompt can go only to the named computer.
  Future<void> send(
    String id,
    String text, {
    String? disclosedRecipient,
    bool holdWhenUnavailable = false,
  });
  Future<void> stop(String id);
  Future<void> retry(String id, {String? disclosedRecipient});

  /// Asks the recipient what became of the lost last answer. Sends no
  /// prompt and runs nothing again.
  Future<RecoverResult> recover(String id);
}

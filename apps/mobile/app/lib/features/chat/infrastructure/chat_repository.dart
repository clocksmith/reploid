import 'dart:async';

import 'package:core/core.dart';

import '../domain/chat.dart';
import 'requester_api.dart';

final class _Thread {
  _Thread(this.id);
  final String id;
  String title = '';
  String? modelId;
  final List<Turn> turns = [];
  Answer? answer;
  StreamSubscription<AnswerEvent>? subscription;
  Completer<void>? running;
  bool stopping = false;
}

/// Conversations and network state for one session, kept in memory only.
///
/// The network connection opens with the first reader or the first prompt
/// and then stays open for the session: an answer needs peers that were
/// already discovered, so dropping it between screens would cost every
/// prompt a fresh discovery. It closes with the session.
final class SessionChatRepository implements ChatRepository {
  SessionChatRepository({
    required this.session,
    required this.api,
    required this.newId,
    this.diagnostics = const Diagnostics(),
  }) {
    session.registerCleanup(close);
  }

  final SessionHandle session;
  final RequesterApi api;
  final String Function() newId;
  final Diagnostics diagnostics;

  final _events = StreamController<void>.broadcast();
  final Map<String, _Thread> _threads = {};
  NetworkSnapshot _network = NetworkSnapshot(
    status: NetworkStatus.offline,
    computers: const [],
  );
  StreamSubscription<NetworkSnapshot>? _networkSubscription;
  FailureKind? _networkFailure;
  bool _connecting = false;
  bool _allowed = true;
  bool _closed = false;
  Future<void>? _closing;
  int _subscribers = 0;

  int get subscriberCount => _subscribers;
  bool get isClosed => _closed;
  bool get _active => !_closed && session.isActive;

  void _checkActive() {
    session.requireActive();
    if (_closed) throw const AppFailure(FailureKind.sessionExpired);
  }

  void _emit() {
    if (_active) _events.add(null);
  }

  Stream<T> _watch<T>(T Function() snapshot, [void Function()? ensure]) =>
      Stream.multi((controller) {
        if (!_active) {
          controller.closeSync();
          return;
        }
        _subscribers++;
        final subscription = _events.stream.listen((_) {
          if (_active) controller.addSync(snapshot());
        }, onDone: controller.closeSync);
        controller.onCancel = () async {
          _subscribers--;
          await subscription.cancel();
        };
        ensure?.call();
        controller.addSync(snapshot());
      });

  // Network -----------------------------------------------------------------

  NetworkResource _networkResource() {
    final computers = _network.computers;
    return NetworkResource(
      sessionKey: session.key,
      status: _connecting && _network.status == NetworkStatus.offline
          ? NetworkStatus.connecting
          : _network.status,
      models: [
        for (final model in api.catalog)
          ModelOption(
            id: model.id,
            name: model.name,
            readyComputers: computers
                .where((c) => c.modelId == model.id && c.ready && !c.busy)
                .length,
            busyComputers: computers
                .where((c) => c.modelId == model.id && c.ready && c.busy)
                .length,
          ),
      ],
      computers: computers,
      networkAnswersAllowed: _allowed,
      failure: _networkFailure,
    );
  }

  void _ensureOpen() {
    if (_networkSubscription != null || !_active) return;
    _networkSubscription = api.watch().listen((snapshot) {
      if (!_active) return;
      _network = snapshot;
      _emit();
    });
    unawaited(reconnect());
  }

  @override
  Stream<NetworkResource> watchNetwork() =>
      _watch(_networkResource, _ensureOpen);

  @override
  Future<void> reconnect() async {
    _checkActive();
    if (_connecting) return;
    _connecting = true;
    _networkFailure = null;
    _emit();
    try {
      await api.open();
    } catch (error) {
      if (_active) _networkFailure = _kind(error);
    } finally {
      _connecting = false;
      _emit();
    }
  }

  @override
  Future<void> setNetworkAnswersAllowed(bool allowed) async {
    _checkActive();
    _allowed = allowed;
    _emit();
  }

  // Conversations -----------------------------------------------------------

  Conversation _conversation(_Thread thread) => Conversation(
    id: thread.id,
    title: thread.title,
    modelId: thread.modelId,
    turns: thread.turns,
  );

  @override
  Stream<ConversationListResource> watchList() => _watch(
    () => ConversationListResource(
      sessionKey: session.key,
      conversations: _threads.values
          .map(_conversation)
          .toList()
          .reversed
          .toList(),
    ),
  );

  @override
  Stream<ConversationResource> watch(String id) => _watch(() {
    final thread = _threads[id];
    return ConversationResource(
      sessionKey: session.key,
      conversation: thread == null ? null : _conversation(thread),
    );
  }, _ensureOpen);

  @override
  String create() {
    _checkActive();
    final thread = _Thread(newId());
    _threads[thread.id] = thread;
    _emit();
    return thread.id;
  }

  @override
  void remove(String id) {
    _checkActive();
    final thread = _threads.remove(id);
    if (thread == null) return;
    unawaited(_cancel(thread));
    _emit();
  }

  @override
  void selectModel(String id, String modelId) {
    _checkActive();
    final thread = _require(id);
    if (thread.running != null) throw const AppFailure(FailureKind.conflict);
    if (!api.catalog.any((model) => model.id == modelId)) {
      throw const AppFailure(FailureKind.validation);
    }
    thread.modelId = modelId;
    _emit();
  }

  _Thread _require(String id) =>
      _threads[id] ?? (throw const AppFailure(FailureKind.validation));

  String? _defaultModel() {
    final models = _networkResource().models;
    return (models.where((m) => m.available).firstOrNull ?? models.firstOrNull)
        ?.id;
  }

  @override
  Future<void> send(String id, String text) {
    _checkActive();
    final thread = _require(id);
    // A second tap joins the answer already under way; it never sends twice.
    if (thread.running case final running?) return running.future;
    final prompt = text.trim();
    if (prompt.isEmpty) throw const AppFailure(FailureKind.validation);
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    final modelId = thread.modelId ??= _defaultModel();
    if (modelId == null) throw const AppFailure(FailureKind.unavailable);
    if (thread.title.isEmpty) {
      thread.title = prompt.length > 48
          ? '${prompt.substring(0, 48)}…'
          : prompt;
    }
    thread.turns.add(Turn(id: newId(), role: TurnRole.user, text: prompt));
    return _start(thread, modelId);
  }

  @override
  Future<void> retry(String id) {
    _checkActive();
    final thread = _require(id);
    if (thread.running case final running?) return running.future;
    if (!_conversation(thread).canRetry) {
      throw const AppFailure(FailureKind.validation);
    }
    if (!_allowed) throw const AppFailure(FailureKind.forbidden);
    thread.turns.removeLast();
    return _start(thread, thread.modelId!);
  }

  Future<void> _start(_Thread thread, String modelId) {
    _ensureOpen();
    final messages = [
      for (final turn in thread.turns)
        if (turn.role == TurnRole.user ||
            (turn.phase == AnswerPhase.complete && turn.text.isNotEmpty))
          PromptMessage(turn.role, turn.text),
    ];
    final answerId = newId();
    thread.turns.add(
      Turn(
        id: answerId,
        role: TurnRole.assistant,
        text: '',
        phase: AnswerPhase.finding,
      ),
    );
    final running = thread.running = Completer<void>();
    thread.stopping = false;
    final answer = thread.answer = api.ask(
      modelId: modelId,
      messages: messages,
    );
    _emit();

    void update(Turn Function(Turn) change) {
      if (!_active || !identical(thread.running, running)) return;
      final index = thread.turns.indexWhere((turn) => turn.id == answerId);
      if (index < 0) return;
      thread.turns[index] = change(thread.turns[index]);
      _emit();
    }

    void finish(AnswerPhase phase, {FailureKind? failure}) {
      if (!identical(thread.running, running)) return;
      update((turn) => turn.copyWith(phase: phase, failure: failure));
      thread.running = null;
      thread.answer = null;
      thread.subscription = null;
      diagnostics.record(
        DiagnosticEvent(
          operation: DiagnosticOperation.submit,
          outcome: switch (phase) {
            AnswerPhase.complete => DiagnosticOutcome.succeeded,
            AnswerPhase.stopped => DiagnosticOutcome.cancelled,
            _ => DiagnosticOutcome.failed,
          },
          failure: failure,
        ),
      );
      _emit();
      running.complete();
    }

    var completed = false;
    thread.subscription = answer.events.listen(
      (event) => switch (event) {
        RecipientProven(:final participantId) => update(
          (turn) => turn.copyWith(
            recipient: participantId,
            phase: AnswerPhase.admitting,
          ),
        ),
        PromptSent() => update(
          (turn) =>
              turn.copyWith(promptSent: true, phase: AnswerPhase.streaming),
        ),
        AnswerChunk(:final text) => update(
          (turn) => turn.copyWith(text: turn.text + text),
        ),
        AnswerCompleted(:final text, :final receiptVerified) => () {
          completed = true;
          update(
            (turn) =>
                turn.copyWith(text: text, receiptVerified: receiptVerified),
          );
        }(),
      },
      onError: (Object error) =>
          finish(AnswerPhase.failed, failure: _kind(error)),
      // A stream that ends without a result and without a stop request is a
      // lost connection, not a choice the person made.
      onDone: () => completed
          ? finish(AnswerPhase.complete)
          : thread.stopping
          ? finish(AnswerPhase.stopped)
          : finish(AnswerPhase.failed, failure: FailureKind.unavailable),
      cancelOnError: true,
    );
    return running.future;
  }

  Future<void> _cancel(_Thread thread) async {
    final answer = thread.answer;
    if (answer == null) return;
    thread.stopping = true;
    await answer.cancel();
  }

  @override
  Future<void> stop(String id) async {
    _checkActive();
    await _cancel(_require(id));
  }

  FailureKind _kind(Object error) =>
      error is AppFailure ? error.kind : FailureKind.unexpected;

  Future<void> close() {
    if (_closing != null) return _closing!;
    _closed = true;
    final threads = _threads.values.toList();
    _threads.clear();
    return _closing = () async {
      for (final thread in threads) {
        await thread.subscription?.cancel();
        await thread.answer?.cancel();
        if (thread.running case final running? when !running.isCompleted) {
          running.complete();
        }
      }
      await _networkSubscription?.cancel();
      await api.close();
      await _events.close();
    }();
  }
}

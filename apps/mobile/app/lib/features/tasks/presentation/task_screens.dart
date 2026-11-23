import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, VoidCallback, ValueChanged;
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../../../l10n/strings.dart';
import '../domain/task.dart';
import 'task_providers.dart';

class TaskListScreen extends ConsumerWidget {
  const TaskListScreen({
    super.key,
    required this.session,
    required this.actions,
    required this.openTask,
  });
  final SessionHandle session;
  final Widget actions;
  final ValueChanged<String> openTask;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(taskListProvider);
    final value = async.asData?.value;
    final data = value?.sessionKey == session.key ? value : null;
    final error =
        data?.failure ?? (async.hasError ? FailureKind.unexpected : null);
    return PageSurface(
      title: Strings.tasks,
      children: [
        const SectionHeading(
          title: Strings.taskHeading,
          eyebrow: Strings.workspace,
          description: Strings.taskSubtitle,
        ),
        actions,
        SecondaryAction(
          label: Strings.refresh,
          onPressed: () =>
              unawaited(ref.read(taskRepositoryProvider)?.refreshList()),
        ),
        AsyncContent(
          loadingLabel: Strings.loading,
          emptyLabel: Strings.empty,
          retryLabel: Strings.retry,
          loading: data?.loading ?? async.isLoading,
          errorMessage: error == null ? null : Strings.failure(error),
          onRetry: () =>
              unawaited(ref.read(taskRepositoryProvider)?.refreshList()),
          content: data == null || data.tasks.isEmpty
              ? null
              : Section(
                  children: [
                    for (final resource in data.tasks)
                      if (resource.task case final task?)
                        ActionTile(
                          title: task.title,
                          highlighted: task.completed,
                          status: _status(resource),
                          onPressed: () => openTask(task.id),
                        ),
                  ],
                ),
        ),
      ],
    );
  }
}

class TaskDetailScreen extends ConsumerWidget {
  const TaskDetailScreen({
    super.key,
    required this.session,
    required this.taskId,
    required this.actions,
    this.rejectNext,
    this.loseNext,
  });
  final SessionHandle session;
  final String taskId;
  final Widget actions;
  final VoidCallback? rejectNext;
  final VoidCallback? loseNext;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(taskProvider(taskId));
    final value = async.asData?.value;
    final data = value?.sessionKey == session.key ? value : null;
    final error =
        data?.failure ?? (async.hasError ? FailureKind.unexpected : null);
    return PageSurface(
      title: Strings.taskDetail,
      children: [
        actions,
        SecondaryAction(
          label: Strings.refresh,
          onPressed: () =>
              unawaited(ref.read(taskRepositoryProvider)?.refresh(taskId)),
        ),
        AsyncContent(
          loadingLabel: Strings.loading,
          emptyLabel: Strings.empty,
          retryLabel: Strings.retry,
          loading: data?.loading ?? async.isLoading,
          errorMessage: error == null ? null : Strings.failure(error),
          onRetry: () =>
              unawaited(ref.read(taskRepositoryProvider)?.refresh(taskId)),
          content: data?.task == null
              ? null
              : _TaskForm(
                  resource: data!,
                  rejectNext: rejectNext,
                  loseNext: loseNext,
                  submit: (note) async {
                    final repository = ref.read(taskRepositoryProvider);
                    if (repository == null || !session.isActive) return;
                    try {
                      if (data.needsRetry) {
                        await repository.retryCompletion(taskId);
                      } else {
                        await repository.complete(taskId, note);
                      }
                    } on AppFailure {
                      // Repository state owns recovery; the form retains its draft.
                    }
                  },
                ),
        ),
      ],
    );
  }
}

class _TaskForm extends HookWidget {
  const _TaskForm({
    required this.resource,
    required this.submit,
    this.rejectNext,
    this.loseNext,
  });
  final TaskResource resource;
  final Future<void> Function(String) submit;
  final VoidCallback? rejectNext;
  final VoidCallback? loseNext;

  @override
  Widget build(BuildContext context) {
    final input = useTextEditingController();
    useListenable(input);
    final task = resource.task!;
    return Section(
      children: [
        _status(resource),
        SectionHeading(title: task.title),
        if (task.completed && !resource.pending && !resource.needsRetry)
          ContentCard(children: [BodyCopy(task.note)])
        else ...[
          NoteInput(
            controller: input,
            label: Strings.note,
            hint: Strings.noteHint,
            readOnly: resource.pending || resource.needsRetry,
          ),
          ActionButton(
            label: resource.needsRetry
                ? Strings.retryCompletion
                : Strings.complete,
            pendingLabel: Strings.saving,
            pending: resource.pending,
            onPressed: input.text.trim().isEmpty && !resource.needsRetry
                ? null
                : () => unawaited(submit(input.text)),
          ),
          if (rejectNext != null || loseNext != null) ...[
            const BodyCopy(Strings.simulations),
            ActionGroup(
              children: [
                if (rejectNext != null)
                  SecondaryAction(
                    label: Strings.rejectNext,
                    onPressed: resource.pending ? null : rejectNext,
                  ),
                if (loseNext != null)
                  SecondaryAction(
                    label: Strings.loseNext,
                    onPressed: resource.pending ? null : loseNext,
                  ),
              ],
            ),
          ],
        ],
      ],
    );
  }
}

Widget _status(TaskResource resource) => StatusBadge(
  label: resource.pending
      ? Strings.pending
      : resource.task?.completed == true
      ? Strings.completed
      : Strings.open,
  highlighted: resource.task?.completed ?? false,
);

import 'package:flutter/material.dart';

import 'theme.dart';

/// A page whose content scrolls above a footer that stays in reach, such as
/// a conversation with its composer. Feature code supplies the children.
class ThreadSurface extends StatelessWidget {
  const ThreadSurface({
    super.key,
    required this.title,
    required this.children,
    required this.footer,
    this.actions = const [],
    this.scrollController,
  });
  final String title;
  final List<Widget> children;
  final Widget footer;
  final List<Widget> actions;
  final ScrollController? scrollController;

  @override
  Widget build(BuildContext context) {
    final spacing = UiSpacing.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: spacing.contentWidth),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: ListView.separated(
                    controller: scrollController,
                    padding: EdgeInsets.all(spacing.inset),
                    itemCount: children.length,
                    separatorBuilder: (_, _) => SizedBox(height: spacing.gap),
                    itemBuilder: (_, index) => children[index],
                  ),
                ),
                const Divider(),
                Padding(
                  padding: EdgeInsets.fromLTRB(
                    spacing.inset,
                    spacing.gap,
                    spacing.inset,
                    spacing.gap,
                  ),
                  child: footer,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// One turn of a conversation. [outgoing] turns sit at the end edge.
/// [status] is announced when it changes, so a stream's progress is heard.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.text,
    required this.author,
    this.outgoing = false,
    this.status,
    this.caption,
    this.failed = false,
    this.actions = const [],
  });
  final String text;
  final String author;
  final bool outgoing;
  final String? status;
  final String? caption;
  final bool failed;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final muted = theme.textTheme.labelMedium?.copyWith(
      color: failed ? colors.error : colors.onSurfaceVariant,
    );
    return Align(
      alignment: outgoing
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: FractionallySizedBox(
        widthFactor: .88,
        alignment: outgoing
            ? AlignmentDirectional.centerEnd
            : AlignmentDirectional.centerStart,
        child: Semantics(
          container: true,
          label: author,
          child: Column(
            crossAxisAlignment: outgoing
                ? CrossAxisAlignment.end
                : CrossAxisAlignment.start,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  color: outgoing
                      ? colors.primaryContainer
                      : colors.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: failed
                        ? colors.error
                        : colors.outlineVariant.withValues(alpha: .6),
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  child: SelectableText(
                    text,
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: outgoing
                          ? colors.onPrimaryContainer
                          : colors.onSurface,
                    ),
                  ),
                ),
              ),
              if (status != null) ...[
                const SizedBox(height: 6),
                Semantics(liveRegion: true, child: Text(status!, style: muted)),
              ],
              if (caption != null) ...[
                const SizedBox(height: 4),
                Text(
                  caption!,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ],
              if (actions.isNotEmpty) Wrap(spacing: 4, children: actions),
            ],
          ),
        ),
      ),
    );
  }
}

/// Text entry with one primary action. While [busy], the action becomes
/// [stopLabel] and the draft stays editable but cannot be sent twice.
class Composer extends StatelessWidget {
  const Composer({
    super.key,
    required this.controller,
    required this.hint,
    required this.sendLabel,
    required this.stopLabel,
    required this.onSend,
    required this.onStop,
    this.busy = false,
    this.note,
    this.leading,
  });
  final TextEditingController controller;
  final String hint;
  final String sendLabel;
  final String stopLabel;
  final VoidCallback? onSend;
  final VoidCallback? onStop;
  final bool busy;

  /// Shown under the field, for what sending will disclose and to whom.
  final String? note;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (leading != null) ...[leading!, const SizedBox(height: 8)],
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: TextField(
                controller: controller,
                minLines: 1,
                maxLines: 5,
                textInputAction: TextInputAction.newline,
                decoration: InputDecoration(
                  hintText: hint,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            if (busy)
              OutlinedButton(onPressed: onStop, child: Text(stopLabel))
            else
              FilledButton(onPressed: onSend, child: Text(sendLabel)),
          ],
        ),
        if (note != null) ...[
          const SizedBox(height: 8),
          Text(
            note!,
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

enum NoticeTone { neutral, warning, error }

/// A short standing message inside a page, not a transient snackbar.
class Notice extends StatelessWidget {
  const Notice({
    super.key,
    required this.text,
    this.tone = NoticeTone.neutral,
    this.action,
  });
  final String text;
  final NoticeTone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final (background, foreground) = switch (tone) {
      NoticeTone.neutral => (colors.surfaceContainer, colors.onSurface),
      NoticeTone.warning => (
        colors.tertiaryContainer,
        colors.onTertiaryContainer,
      ),
      NoticeTone.error => (colors.errorContainer, colors.onErrorContainer),
    };
    return Semantics(
      liveRegion: tone != NoticeTone.neutral,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                text,
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: foreground),
              ),
              ?action,
            ],
          ),
        ),
      ),
    );
  }
}

/// A setting with a switch; the whole row toggles and is one semantic node.
class SwitchRow extends StatelessWidget {
  const SwitchRow({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.description,
  });
  final String label;
  final String? description;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) => SwitchListTile.adaptive(
    contentPadding: EdgeInsets.zero,
    title: Text(label, style: Theme.of(context).textTheme.titleMedium),
    subtitle: description == null ? null : Text(description!),
    value: value,
    onChanged: onChanged,
  );
}

/// One option among several, with the chosen one marked.
class ChoiceTile extends StatelessWidget {
  const ChoiceTile({
    super.key,
    required this.title,
    required this.selected,
    required this.onPressed,
    this.detail,
    this.trailing,
  });
  final String title;
  final String? detail;
  final bool selected;
  final VoidCallback? onPressed;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Card(
      child: Semantics(
        button: true,
        selected: selected,
        enabled: onPressed != null,
        child: InkWell(
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                ExcludeSemantics(
                  child: Icon(
                    selected
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_unchecked_rounded,
                    color: onPressed == null
                        ? colors.onSurfaceVariant
                        : colors.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: theme.textTheme.titleMedium),
                      if (detail != null)
                        Text(
                          detail!,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A labelled value the person may need to read out or compare, in a
/// fixed-width face so similar identifiers line up.
class LabeledValue extends StatelessWidget {
  const LabeledValue({super.key, required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return MergeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 2),
          SelectableText(
            value,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontFamily: 'monospace',
            ),
          ),
        ],
      ),
    );
  }
}

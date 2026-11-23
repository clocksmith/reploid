import 'package:flutter/material.dart';

import 'theme.dart';

/// Ordinary page structure. Feature code supplies content, never layout values.
class PageSurface extends StatelessWidget {
  const PageSurface({super.key, required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: SingleChildScrollView(
      child: ContentArea(child: Section(children: children)),
    ),
  );
}

/// Vertical content rhythm shared by pages, forms, and cards.
class Section extends StatelessWidget {
  const Section({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (var i = 0; i < children.length; i++) ...[
        if (i > 0) SizedBox(height: UiSpacing.of(context).gap),
        children[i],
      ],
    ],
  );
}

class ActionGroup extends StatelessWidget {
  const ActionGroup({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 8,
    runSpacing: 8,
    crossAxisAlignment: WrapCrossAlignment.center,
    children: children,
  );
}

class SecondaryAction extends StatelessWidget {
  const SecondaryAction({super.key, required this.label, this.onPressed});
  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) =>
      TextButton(onPressed: onPressed, child: Text(label));
}

class SectionHeading extends StatelessWidget {
  const SectionHeading({
    super.key,
    required this.title,
    this.eyebrow,
    this.description,
  });
  final String title;
  final String? eyebrow;
  final String? description;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (eyebrow != null) ...[
          Text(
            eyebrow!,
            style: theme.textTheme.labelLarge?.copyWith(
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(height: 12),
        ],
        Semantics(
          header: true,
          child: Text(title, style: theme.textTheme.headlineLarge),
        ),
        if (description != null) ...[
          const SizedBox(height: 12),
          Text(
            description!,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );
  }
}

class ContentCard extends StatelessWidget {
  const ContentCard({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: EdgeInsets.all(UiSpacing.of(context).inset),
      child: Section(children: children),
    ),
  );
}

class BodyCopy extends StatelessWidget {
  const BodyCopy(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: Theme.of(context).textTheme.bodyLarge);
}

/// A navigable resource, independent of models, repositories, or accounts.
class ActionTile extends StatelessWidget {
  const ActionTile({
    super.key,
    required this.title,
    required this.status,
    required this.onPressed,
    this.highlighted = false,
  });
  final String title;
  final Widget status;
  final VoidCallback onPressed;
  final bool highlighted;

  @override
  Widget build(BuildContext context) => Card(
    child: Semantics(
      button: true,
      child: InkWell(
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            children: [
              ExcludeSemantics(
                child: Icon(
                  highlighted
                      ? Icons.check_circle_rounded
                      : Icons.radio_button_unchecked_rounded,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    status,
                  ],
                ),
              ),
              const SizedBox(width: 12),
              const ExcludeSemantics(
                child: Icon(Icons.arrow_forward_rounded, size: 20),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, this.highlighted = false});
  final String label;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    return Align(
      alignment: AlignmentDirectional.centerStart,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: highlighted
              ? colors.secondaryContainer
              : colors.surfaceContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          label,
          style: theme.textTheme.labelMedium?.copyWith(
            color: highlighted
                ? colors.onSecondaryContainer
                : colors.onSurfaceVariant,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class NoteInput extends StatelessWidget {
  const NoteInput({
    super.key,
    required this.controller,
    required this.label,
    required this.hint,
    this.readOnly = false,
  });
  final TextEditingController controller;
  final String label;
  final String hint;
  final bool readOnly;

  @override
  Widget build(BuildContext context) => TextField(
    controller: controller,
    readOnly: readOnly,
    decoration: InputDecoration(labelText: label, hintText: hint),
    minLines: 2,
    maxLines: 5,
  );
}

void showNotice(BuildContext context, String text) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

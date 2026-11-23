import 'package:flutter/material.dart';

/// Layout roles that can be replaced by each app's design system.
@immutable
final class UiSpacing extends ThemeExtension<UiSpacing> {
  const UiSpacing({this.gap = 16, this.inset = 24, this.contentWidth = 760});

  final double gap;
  final double inset;
  final double contentWidth;

  static UiSpacing of(BuildContext context) =>
      Theme.of(context).extension<UiSpacing>() ?? const UiSpacing();

  @override
  UiSpacing copyWith({double? gap, double? inset, double? contentWidth}) =>
      UiSpacing(
        gap: gap ?? this.gap,
        inset: inset ?? this.inset,
        contentWidth: contentWidth ?? this.contentWidth,
      );

  @override
  UiSpacing lerp(covariant UiSpacing? other, double t) => other == null
      ? this
      : UiSpacing(
          gap: gap + (other.gap - gap) * t,
          inset: inset + (other.inset - inset) * t,
          contentWidth: contentWidth + (other.contentWidth - contentWidth) * t,
        );
}

/// Apps own font assets and branding; all components share these state styles.
ThemeData createUiTheme({
  required Color seedColor,
  Brightness brightness = Brightness.light,
  UiSpacing spacing = const UiSpacing(),
  String? fontFamily,
}) {
  final colors = ColorScheme.fromSeed(
    seedColor: seedColor,
    brightness: brightness,
    surface: brightness == Brightness.light
        ? const Color(0xfff8f8f5)
        : const Color(0xff151917),
  );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: colors,
    fontFamily: fontFamily,
    extensions: [spacing],
  );
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  WidgetStateProperty<Color?> overlay(Color color) =>
      WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return Colors.transparent;
        if (states.contains(WidgetState.pressed)) {
          return color.withValues(alpha: .16);
        }
        if (states.contains(WidgetState.focused)) {
          return color.withValues(alpha: .12);
        }
        if (states.contains(WidgetState.hovered)) {
          return color.withValues(alpha: .07);
        }
        return Colors.transparent;
      });
  final button = ButtonStyle(
    minimumSize: const WidgetStatePropertyAll(Size(48, 52)),
    padding: const WidgetStatePropertyAll(
      EdgeInsets.symmetric(horizontal: 22, vertical: 14),
    ),
    shape: WidgetStatePropertyAll(shape),
    animationDuration: const Duration(milliseconds: 160),
    textStyle: WidgetStatePropertyAll(
      base.textTheme.labelLarge?.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        letterSpacing: .1,
      ),
    ),
    side: WidgetStateProperty.resolveWith(
      (states) => BorderSide(
        color: states.contains(WidgetState.focused)
            ? colors.primary
            : Colors.transparent,
        width: 2,
      ),
    ),
  );
  return base.copyWith(
    scaffoldBackgroundColor: colors.surface,
    hoverColor: colors.primary.withValues(alpha: .05),
    focusColor: colors.primary.withValues(alpha: .12),
    splashColor: colors.primary.withValues(alpha: .12),
    highlightColor: colors.primary.withValues(alpha: .04),
    textTheme: base.textTheme.copyWith(
      headlineLarge: base.textTheme.headlineLarge?.copyWith(
        fontSize: 36,
        height: 1.15,
        fontWeight: FontWeight.w800,
        letterSpacing: -1.3,
      ),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(
        fontSize: 26,
        height: 1.25,
        fontWeight: FontWeight.w800,
        letterSpacing: -.7,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontSize: 16,
        height: 1.4,
        fontWeight: FontWeight.w700,
        letterSpacing: -.2,
      ),
      bodyLarge: base.textTheme.bodyLarge?.copyWith(fontSize: 16, height: 1.6),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(
        fontSize: 14,
        height: 1.6,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: 72,
      titleSpacing: 24,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleMedium?.copyWith(
        fontWeight: FontWeight.w800,
        letterSpacing: -.4,
      ),
    ),
    cardTheme: CardThemeData(
      color: colors.surfaceContainerLowest,
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: colors.outlineVariant.withValues(alpha: .6)),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: button.copyWith(
        overlayColor: overlay(colors.onPrimary),
        side: WidgetStateProperty.resolveWith(
          (states) => BorderSide(
            color: states.contains(WidgetState.focused)
                ? colors.onPrimary
                : Colors.transparent,
            width: 2,
          ),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: button.copyWith(
        overlayColor: overlay(colors.primary),
        side: WidgetStateProperty.resolveWith(
          (states) => BorderSide(
            color: states.contains(WidgetState.focused)
                ? colors.primary
                : colors.outlineVariant,
            width: states.contains(WidgetState.focused) ? 2 : 1,
          ),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: button.copyWith(
        minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
        overlayColor: overlay(colors.primary),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: button.copyWith(
        padding: const WidgetStatePropertyAll(EdgeInsets.all(12)),
        overlayColor: overlay(colors.primary),
      ),
    ),
    inputDecorationTheme: InputDecorationThemeData(
      filled: true,
      fillColor: colors.surfaceContainerLowest,
      hoverColor: colors.primary.withValues(alpha: .03),
      contentPadding: const EdgeInsets.all(20),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: colors.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: colors.primary, width: 2),
      ),
      alignLabelWithHint: true,
    ),
    dividerTheme: DividerThemeData(
      color: colors.outlineVariant.withValues(alpha: .6),
      thickness: 1,
      space: 1,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: shape,
    ),
  );
}

class ContentArea extends StatelessWidget {
  const ContentArea({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final spacing = UiSpacing.of(context);
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: spacing.contentWidth),
        child: Padding(padding: EdgeInsets.all(spacing.inset), child: child),
      ),
    );
  }
}

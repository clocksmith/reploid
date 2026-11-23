import 'package:core/core.dart';

/// The example ships English. Packages accept app-localized strings directly.
/// Replace this catalog with generated ARB messages when adding locales.
abstract final class Strings {
  static const title = 'Starter';
  static const tasks = 'Tasks';
  static const welcome = 'A little focus.\nA lot of progress.';
  static const welcomeDetail =
      'A quiet place to keep things moving, one task at a time.';
  static const chooseAccount = 'Choose your workspace';
  static const workspace = 'Your workspace';
  static const taskHeading = 'Make room for progress.';
  static const taskSubtitle = 'Pick a task, add a note, and move it forward.';
  static const taskDetail = 'Task details';
  static const noteHint = 'What did you get done?';
  static const simulations = 'Try a recovery flow';
  static const loading = 'Loading tasks';
  static const empty = 'No tasks';
  static const retry = 'Retry';
  static const refresh = 'Refresh';
  static const note = 'Completion note';
  static const complete = 'Complete task';
  static const saving = 'Saving';
  static const completed = 'Completed';
  static const pending = 'Pending';
  static const open = 'Open';
  static const retryCompletion = 'Retry completion';
  static const signOut = 'Sign out';
  static const switching = 'Switching account';
  static const accountA = 'Use account A';
  static const accountB = 'Use account B';
  static const demo = 'Example app with synthetic accounts';
  static const rejectNext = 'Reject next completion';
  static const loseNext = 'Lose next response';
  static const failureArmed =
      'Failure simulation is ready for the next completion.';
  static const sessionFailure =
      'Account cleanup failed. Retry before continuing.';

  static String failure(FailureKind kind) => switch (kind) {
    FailureKind.validation => 'Check the note and try again.',
    FailureKind.conflict =>
      'This task changed. Refresh and review before submitting.',
    FailureKind.unavailable =>
      'The result is uncertain. Retry the same completion.',
    FailureKind.forbidden => 'This action is not available for your account.',
    FailureKind.unauthenticated ||
    FailureKind.sessionExpired => 'Sign in again to continue.',
    FailureKind.unexpected => 'Something went wrong. Try again.',
  };
}

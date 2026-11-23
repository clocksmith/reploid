import 'package:core/core.dart';

/// The app ships English. Packages accept app-localized strings directly.
/// Replace this catalog with generated ARB messages when adding locales.
abstract final class Strings {
  static const title = 'Reploid';
  static const welcome = 'Ask a model that runs\non someone else’s computer.';
  static const welcomeDetail =
      'No model is downloaded to this phone. A participating computer runs '
      'it and can read the prompt it answers. You see which computer before '
      'anything is sent.';
  static const start = 'Start';
  static const starting = 'Setting up this device';
  static const startDetail =
      'Starting creates a signing key that stays on this device. It is how '
      'computers on the network know your requests are yours.';
  static const demoNetwork =
      'Demo build: a synthetic network inside the app. No prompt leaves '
      'this device and no real computer answers.';
  static const sessionFailure = 'This device could not be set up. Try again.';
  static const switching = 'One moment';

  static const chats = 'Chats';
  static const chatsHeading = 'Your conversations';
  static const chatsDetail =
      'Kept in memory on this device and cleared when you forget this '
      'device or close the app.';
  static const newChat = 'New chat';
  static const untitled = 'New chat';
  static const noChats = 'No conversations yet';
  static const loading = 'Loading';
  static const retry = 'Retry';
  static const computers = 'Computers';
  static const settings = 'Settings';
  static const remove = 'Delete';

  static const composerHint = 'Ask anything';
  static const send = 'Send';
  static const stop = 'Stop';
  static const answerOn = 'Answer on';
  static const you = 'You';
  static const assistant = 'Answer';
  static const retryAnswer = 'Ask again';
  static const discloseRemote = 'The answering computer can read your prompt.';
  static const discloseOff =
      'Network answers are off, so nothing can be sent. Turn them on in '
      'Settings to ask.';
  static const noComputer =
      'No computer is ready for this model right now. You can still send; '
      'the request fails without leaving this device if none appears.';
  static const missing = 'This conversation no longer exists.';

  static const finding = 'Finding a ready computer. Nothing has been sent.';
  static const answering = 'Answering';
  static const stopped = 'Stopped. The text above had already arrived.';
  static const receiptVerified = 'signed receipt verified';
  static const receiptUnverified = 'no valid signed receipt';
  static const promptNotSent = 'Your prompt was not sent.';
  static const promptWasSent =
      'The answering computer had already received your prompt.';

  static String checking(String recipient) =>
      'Asking ${shortId(recipient)} to accept. Your prompt has not been sent.';
  static String answeredBy(String recipient, {required bool verified}) =>
      'Answered by ${shortId(recipient)}, '
      '${verified ? receiptVerified : receiptUnverified}';
  static String sentTo(String recipient) => 'Sent to ${shortId(recipient)}';

  /// Enough of a signing identity to compare by eye; the full value is in
  /// Computers.
  static String shortId(String participantId) => participantId.length <= 17
      ? participantId
      : '${participantId.substring(0, 13)}…'
            '${participantId.substring(participantId.length - 4)}';

  static const models = 'Choose a model';
  static const modelsDetail =
      'A model can answer when at least one computer that holds it is ready.';
  static String modelDetail(int ready, int busy) => ready > 0
      ? '$ready ready${busy > 0 ? ', $busy busy' : ''}'
      : busy > 0
      ? 'All $busy busy'
      : 'No computer has it right now';

  static const network = 'Network';
  static const networkHeading = 'Who can answer';
  static const networkDetail =
      'Computers are listed as they announce themselves. An identity is '
      'shown only after that computer proves it holds the matching key.';
  static const online = 'Connected';
  static const connecting = 'Connecting';
  static const offline = 'Not connected';
  static const reconnect = 'Reconnect';
  static const noComputers = 'No computers are announcing themselves';
  static const ready = 'Ready';
  static const busy = 'Busy';
  static const notReady = 'Not ready';
  static const unproven = 'Identity not yet proven';
  static const identity = 'Signing identity';
  static const model = 'Model';

  static const allowNetwork = 'Allow network answers';
  static const allowNetworkDetail =
      'When on, Send gives your prompt to the computer named under it. '
      'Turning this off stops new prompts; it cannot recall one already sent.';
  static const thisDevice = 'This device';
  static const thisDeviceDetail =
      'Computers that answer you see this identity. It carries no name, '
      'account or contact detail.';
  static const forget = 'Forget this device';
  static const forgetDetail =
      'Deletes the signing key and every conversation on this device.';

  static String failure(FailureKind kind) => switch (kind) {
    FailureKind.validation => 'That cannot be sent as it is.',
    FailureKind.conflict => 'Wait for the current answer to finish.',
    FailureKind.unavailable =>
      'No computer could answer, or the connection was lost.',
    FailureKind.forbidden => 'The computer declined the request.',
    FailureKind.unauthenticated ||
    FailureKind.sessionExpired => 'Start again to continue.',
    FailureKind.unexpected => 'Something went wrong. Try again.',
  };
}

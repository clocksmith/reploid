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
      'Encrypted on this device until you delete a chat or forget this device.';
  static const newChat = 'New chat';
  static const untitled = 'New chat';
  static const emptyChat = 'Empty';
  static const draft = 'Draft';
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
  static String discloseComputer(String participantId) =>
      'Sending to ${shortId(participantId)}. It can read your prompt.';
  static String disclosePool(int count, String participantId) =>
      'Sending to ${shortId(participantId)}, the best of $count ready '
      'computers. It can read your prompt.';
  static const checkAnswer = 'Check for the answer';
  static const recoverNotYet =
      'No answer yet. That computer is offline, still working, or no longer '
      'has it. Nothing was sent again.';
  static const recoverEnded =
      'That computer says the request ended without an answer.';
  static const attach = 'Attach text file';
  static String removeFile(String name) => 'Remove $name';
  static String attached(List<String> names) => 'Attached: ${names.join(', ')}';
  static const attachLimits =
      'Attach up to 8 text files (.txt, .md, .json, .js, .ts, .html, .css), '
      '64 KB each and 128 KB in total. Nothing was added.';
  static const attachDisclosure =
      'The whole text of attached files goes with the prompt.';
  static const details = 'Details';
  static const hideDetails = 'Hide details';
  static const attempt = 'Attempt';
  static const receipt = 'Signed receipt';
  static const receiptOk = 'Verified on this device';
  static const receiptNone = 'None verified';
  static const promptLeft = 'Prompt left this device';
  static const yes = 'Yes';
  static const no = 'No';
  static const appearance = 'Appearance';
  static const appearanceSystem = 'System';
  static const appearanceLight = 'Light';
  static const appearanceDark = 'Dark';
  static const yourData = 'Your data';
  static const yourDataDetail =
      'Conversations, computer names and blocked computers on this phone, '
      'as one file the web app can also read. The file is not encrypted. It '
      'holds no private keys, room tokens or pairings.';
  static const exportData = 'Export my data';
  static const importData = 'Import data';
  static const importConfirm = 'Import';
  static const importNote =
      'Imported conversations are added to this phone. Nothing is sent, and '
      'sharing permissions are not imported.';
  static const importInvalid = 'This file is not a Reploid data export.';
  static const dataFailed = 'That did not work. Nothing was changed.';
  static const importNothing = 'Nothing in this file is new here.';
  static String _count(int count, String one, [String? many]) =>
      '$count ${count == 1 ? one : many ?? '${one}s'}';
  static String exported(int count, int omitted) =>
      'Exported ${_count(count, 'conversation')}.'
      '${omitted == 0 ? '' : ' ${_count(omitted, 'conversation')} could not be written.'}';
  static String importSummary(
    int conversations,
    int names,
    int blocked,
    int skipped,
  ) =>
      'This file adds ${_count(conversations, 'conversation')}, '
      '${_count(names, 'computer name')} and '
      '${_count(blocked, 'blocked computer')}.'
      '${skipped == 0 ? '' : ' Skipped, nothing overwritten: $skipped already here.'}';
  static String imported(int conversations, int names, int blocked) =>
      'Imported ${_count(conversations, 'conversation')}, '
      '${_count(names, 'computer name')} and '
      '${_count(blocked, 'blocked computer')}.';
  static const block = 'Block';
  static const unblock = 'Unblock';
  static const blockedLabel = 'Blocked';
  static const blockedHeading = 'Blocked computers';
  static const blockedDetail =
      'This phone never sends a prompt to a blocked computer.';
  static const computerName = 'Your name for this computer';
  static const computerNameHint = 'Workbench';
  static const saveName = 'Save name';
  static const recipientChanged =
      'The computer that would answer just changed, so nothing was sent. '
      'Check the name and send again.';
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
  static String answeredBy(
    String recipient, {
    required bool verified,
    String? model,
  }) =>
      'Answered by ${shortId(recipient)}'
      '${model == null || model.isEmpty ? '' : ' ($model)'}, '
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

  static const yourDesktop = 'Your desktop';
  static const pairIntro =
      'Pair this phone with your own computer and it can answer you. On '
      'the desktop, start Reploid, type pair, and paste the link it shows.';
  static const pairingLink = 'Pairing link';
  static const pairingLinkHint = 'https://replo.id/#pair=…';
  static const pairCheck = 'Read link';
  static const invalidLink = 'That is not a pairing link.';
  static String connectTo(String label) => 'Connect to $label?';
  static const pairWarn =
      'Check that this is the identity your desktop shows. Whoever opens a '
      'pairing link first can use it, so the desktop also asks its owner.';
  static const connect = 'Connect';
  static const cancel = 'Cancel';
  static const thisPhone = 'This phone';
  static const thisPhoneDetail =
      'Your desktop will ask whether to pair this identity.';
  static const findingDesktop =
      'Looking for your desktop. The pairing code has not been sent.';
  static const approveOnDesktop = 'Approve on your desktop.';
  static String pairFailure(FailureKind kind) => switch (kind) {
    FailureKind.unavailable =>
      'The desktop was not found or did not answer. Check that it is '
          'online, get a fresh link, and try again.',
    FailureKind.forbidden => 'The desktop declined the pairing.',
    FailureKind.unauthenticated =>
      'A computer answered that is not the desktop in the link. Nothing '
          'was paired.',
    FailureKind.validation => invalidLink,
    _ => failure(kind),
  };
  static String desktopOffline(String label) =>
      '$label is offline. Open Reploid on $label.';
  static const unpair = 'Unpair desktop';
  static const unpairDetail =
      'This phone forgets the desktop. The desktop keeps listing this '
      'phone until its own pairing data is removed.';
  static String discloseDesktop(String label) =>
      'Sending to $label. Its operator can read your prompt.';
  static const whereToAnswer = 'Where to answer';
  static String targetDesktop(String label) => 'Your desktop: $label';
  static const targetContributors = 'Contributors';
  static const contributorsDetail = 'A participating computer you do not know.';
  static const desktopDetailOnline = 'Online. Only this computer is asked.';
  static const pairAgain =
      'Your desktop no longer lists this phone. Pair again in Computers.';

  static const allowNetwork = 'Allow network answers';
  static const allowNetworkDetail =
      'When on, Send gives your prompt to the computer named under it. '
      'Turning this off stops new prompts; it cannot recall one already sent.';
  static const networkSettings = 'Network connection';
  static const networkSettingsDetail =
      'Choose where answers come from. Applying reconnects this session.';
  static const networkModeDemo = 'Demo (synthetic)';
  static const networkModeDemoDetail =
      'Runs inside this app with no network traffic.';
  static const networkModePublic = 'Public Reploid network';
  static const networkModePublicDetail =
      'Connects to participating computers on the public room.';
  static const networkModeRoom = 'Private room';
  static const networkModeRoomDetail =
      'Connects to a signaling URL and room token you specify.';
  static const signalingUrl = 'Signaling URL';
  static const signalingUrlHint = 'wss://example.com/swarm';
  static const roomId = 'Room ID';
  static const roomIdHint = 'reploid-swarm-example';
  static const roomToken = 'Join token';
  static const roomTokenHint = 'At least 32 characters';
  static const rtcConfigUrl = 'TURN config URL (optional)';
  static const rtcConfigUrlHint = 'https://example.com/rtc-config';
  static const applyNetwork = 'Apply network';
  static const networkInvalid =
      'Enter a ws:// or wss:// URL, a room ID, and a token of at least '
      '32 characters.';
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

// Older mobile implementations support WebAuthn before the optional JSON helpers.
// The circle requests only discovery, verification and ordinary credential IDs.
function decode(value) {
  return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),ch => ch.charCodeAt(0));
}
function encode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
async function obtainPasskey(action,options) {
  if (!globalThis.PublicKeyCredential || !navigator.credentials) throw Error('Open this link in a browser with passkeys enabled.');
  const create = action === 'register';
  const parse = create ? PublicKeyCredential.parseCreationOptionsFromJSON : PublicKeyCredential.parseRequestOptionsFromJSON;
  let publicKey;
  if (parse) publicKey = parse.call(PublicKeyCredential,options);
  else {
    publicKey = {...options,challenge:decode(options.challenge)};
    if (create) publicKey.user = {...options.user,id:decode(options.user.id)};
    const key = create ? 'excludeCredentials' : 'allowCredentials';
    if (options[key]) publicKey[key] = options[key].map(credential => ({...credential,id:decode(credential.id)}));
  }
  const credential = create ? await navigator.credentials.create({publicKey}) : await navigator.credentials.get({publicKey});
  if (typeof credential.toJSON === 'function') return credential.toJSON();
  const native = credential.response;
  const response = {clientDataJSON:encode(native.clientDataJSON)};
  if (create) {
    response.attestationObject = encode(native.attestationObject);
    if (typeof native.getTransports === 'function') response.transports = native.getTransports();
  } else {
    response.authenticatorData = encode(native.authenticatorData);response.signature = encode(native.signature);
    response.userHandle = native.userHandle ? encode(native.userHandle) : null;
  }
  return {id:credential.id,rawId:encode(credential.rawId),type:credential.type,response,
    clientExtensionResults:credential.getClientExtensionResults(),authenticatorAttachment:credential.authenticatorAttachment ?? undefined};
}

const el = id => document.getElementById(id);
function append(parent, tag, text, classes) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (classes) node.className = classes;
  parent.append(node);
  return node;
}
const pageUrl = new URL(location.href);
// Only the assets build for the stable public site supplies a pinned API origin.
const apiOrigin = document.querySelector('meta[name="daily-api-origin"]')?.content ?? pageUrl.origin;
if (apiOrigin !== pageUrl.origin && (new URL(apiOrigin).origin !== apiOrigin || !apiOrigin.startsWith('https://'))) {
  throw Error('This circle has an invalid API origin.');
}
const fragment = new URLSearchParams(pageUrl.hash.slice(1));
let invite = fragment.get('invite');
// Only needed when the browser rejects the public API’s partitioned cookies.
let tabSession;
let playerPass = fragment.get('player');
if (playerPass) {
  fragment.delete('player');
  pageUrl.hash = fragment.toString();
  history.replaceState(null,'',pageUrl);
}
const incoming = pageUrl.searchParams.get('share');
let today, retry, deferredTurn, selectedAttempt, submitting = false, sentCode = false;
const feedback = message => { el('feedback').textContent = message; };
const words = n => n + (n === 1 ? ' word' : ' words');
const score = record => words(record.words) + ' · ' + record.characters + ' chars';
const challengeNumber = day => day.replaceAll('-', '');
function scorecard(record) {
  return 'Reploid Daily #' + challengeNumber(record.day) + ' · Got it in ' + words(record.words)
    + ' · ' + record.attemptNumber + '/3 tries';
}
function dareLink(id) {
  const url = new URL('/',location.origin);
  url.searchParams.set('share',id);
  if (invite) url.hash = new URLSearchParams({invite});
  return url.href;
}
async function api(path, data) {
  const headers = invite ? {'x-circle-invite':invite} : {};
  if (tabSession && ['today','attempt','share'].includes(path.split('?')[0])) headers['x-daily-tab'] = tabSession;
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL('/api/' + path,apiOrigin),{method:data ? 'POST' : 'GET',headers,credentials:apiOrigin === pageUrl.origin ? 'same-origin' : 'include',
    redirect:'error',
    body:data ? JSON.stringify(data) : undefined});
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'The circle could not finish the request.');
  return result;
}
function showDialog(id) {
  const dialog = el(id);
  if (!dialog.open) dialog.showModal();
}
document.addEventListener('click',event => {
  const button = event.target.closest('[data-open],[data-close]');
  if (button?.dataset.open) showDialog(button.dataset.open);
  else if (button) button.closest('dialog').close();
  else if (event.target instanceof HTMLDialogElement) {
    const box = event.target.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.target.close();
  }
});
function updateForm() {
  const value = el('prompt').value.trim().normalize('NFC');
  const count = value.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.length || 0;
  const characters = [...value].length;
  el('count').textContent = characters > 220 ? characters + '/240 characters' : words(count);
  el('submit').disabled = submitting || !today || today.availability !== 'ready'
    || today.history.length >= 3 || count === 0 || characters > 240;
  el('submit').textContent = submitting ? 'Running…' : 'Submit prompt';
}
function showShare(attempt) {
  selectedAttempt = attempt;
  el('share-score').textContent = scorecard(attempt);
  el('allow-reveal').checked = Boolean(attempt.allowReveal);
  el('share-link').hidden = true;
  el('share-status').textContent = '';
  showDialog('share-sheet');
}
function attemptRow(parent,attempt,showPrompt) {
  const row = append(parent,'article','','attempt pool-well pool-stack pool-gap-sm');
  const complete = attempt.status === 'completed';
  let label = 'Waiting for the model';
  if (complete) label = attempt.won ? 'Matched in ' + words(attempt.words) : 'Miss';
  else if (attempt.status === 'unresolved') label = 'Outcome unresolved';
  append(row,'strong',label,'pool-subheading');
  if (showPrompt) append(row,'p',attempt.prompt,'pool-small pool-muted');
  if (complete) append(row,'blockquote',attempt.output || '(empty answer)','pool-body');
  if (attempt.won) {
    const button = append(row,'button','Share this win','pool-button');
    button.type = 'button';
    button.onclick = () => showShare(attempt);
  }
}
function renderAttempts(history) {
  el('attempts').hidden = !history.length;
  el('past-button').hidden = history.length < 2;
  el('history').replaceChildren();
  el('past-list').replaceChildren();
  if (history.length) attemptRow(el('history'),history.at(-1),false);
  for (const attempt of [...history].reverse()) attemptRow(el('past-list'),attempt,true);
}
function renderScoreboard() {
  const {leaderboard,yesterdayWinners,revealChoices} = today;
  el('leaderboard').replaceChildren();
  for (const row of leaderboard) append(el('leaderboard'),'li',score(row),'pool-body').value = row.rank;
  el('leader-empty').hidden = leaderboard.length > 0;
  const yesterday = el('yesterday');
  yesterday.replaceChildren();
  if (!yesterdayWinners.length) append(yesterday,'p','No reviewed winning prompts to show.','pool-small pool-muted');
  for (const winner of yesterdayWinners) {
    append(yesterday,'blockquote',winner.prompt,'pool-body');
    append(yesterday,'small',score(winner),'pool-caption pool-muted');
  }
  for (const own of revealChoices) {
    const button = append(yesterday,'button','Withdraw my prompt: ' + own.prompt,'pool-button');
    button.onclick = async () => {
      button.disabled = true;
      try {await api('share',{attemptId:own.id,allowReveal:false}); await refresh();}
      catch (error) {button.disabled = false; feedback(error.message); el('scores').close();}
    };
  }
}
function render() {
  const {availability,challenge,share,shareChallenge,history,authenticated,authMode} = today;
  const remaining = Math.max(0,3 - history.length);
  const playable = challenge?.playable ?? challenge?.qualified;
  el('date').textContent = challenge?.day ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(challenge.day+'T12:00:00Z')) : '';
  el('mode').textContent = today.mode === 'playtest' ? 'Playtest' : '';
  el('circle').textContent = today.circle === 'Reploid Daily' ? '' : today.circle;
  el('target').textContent = challenge?.target || 'Next puzzle pending';
  el('banned').textContent = challenge?.banned.length ? 'Without ' + challenge.banned.map(w => '“' + w + '”').join(', ') + '.' : '';
  el('model').textContent = challenge?.modelId || 'No model assigned.';
  let tries = playable ? '3 tries today' : '';
  if (authenticated) tries = remaining + ' of 3 tries left';
  el('tries').textContent = tries;
  el('disclosure').textContent = 'Readable by ' + (today.relayName ? today.relayName + ' and ' : '') + (today.recipientName || today.circle) + '.';
  el('attempt-form').hidden = !playable || !today.inviteValid || !remaining || availability !== 'ready';
  const canJoin = today.inviteValid && !authenticated && ['ready','busy','host-full'].includes(availability);
  el('open-join').hidden = !canJoin;
  el('auth').hidden = !canJoin || (authMode && authMode !== 'email');
  el('passkey-join').hidden = !canJoin || authMode !== 'passkey';
  el('grant-form').hidden = !canJoin || authMode !== 'host-grant';
  el('dare').hidden = !share;
  if (share) {
    el('dare-score').textContent = 'Beat ' + words(share.words) + (share.day === challenge?.day ? '.' : ' · Played on ' + share.day);
    el('dare-target').textContent = shareChallenge?.target ? 'Target: ' + shareChallenge.target : '';
    el('dare-output').textContent = share.output || '(empty answer)';
    el('dare-proof').textContent = scorecard(share) + ' · ' + today.circle + ' · ' + share.receiptDigest;
  }
  const notices = {'host-full':'This circle is full today.', busy:'The host is playing another turn.',
    staged:'Ranked play hasn’t opened yet.', 'configuration-changed':'Scoring is paused for today.',
    'needs-invite':'Open a circle invite to play.', 'invalid-invite':'This invite expired. Ask your host for a new link.',
    ready:authenticated && !remaining ? 'Come back at midnight UTC for the next target.' : ''};
  const status = el('status');
  status.replaceChildren(document.createTextNode(notices[availability] ?? 'The circle is unavailable.'));
  if (availability === 'busy') {
    status.append(' ');
    const button = append(status,'button','Refresh','pool-button btn-ghost');
    button.onclick = () => refresh().catch(error => feedback(error.message));
  } else if (availability === 'host-full') {
    status.append(' ');
    append(status,'a','Host your own').href = '/host.html';
  }
  renderAttempts(history);
  renderScoreboard();
  updateForm();
}
async function refresh() {
  today = await api('today' + (incoming ? '?share=' + encodeURIComponent(incoming) : ''));
  if (!invite && today.publicInvite) invite = today.publicInvite;
  if (!today.authenticated) tabSession = undefined;
  render();
}
async function afterLogin() {
  await refresh();
  if (!today.authenticated) throw Error('Your sign-in expired before your draft was submitted. Your draft is still here. Sign in again to continue.');
  if (el('join').open) el('join').close();
  el('join-status').textContent = '';
  el('prompt').focus();
  if (deferredTurn && deferredTurn.day === today.challenge?.day && deferredTurn.digest === today.challenge?.digest
    && deferredTurn.prompt === el('prompt').value) {
    deferredTurn = null;
    el('attempt-form').requestSubmit();
  } else deferredTurn = null;
}
el('join').addEventListener('cancel',() => {deferredTurn = null;});
el('join').querySelector('[data-close]').addEventListener('click',() => {deferredTurn = null;});
async function join(grant) {
  await api('auth/grant',{grant});
  await afterLogin();
}
el('grant-form').onsubmit = async event => {
  event.preventDefault();
  const field = el('grant');
  try {await join(field.value.trim());field.value = '';feedback('');}
  catch (error) {feedback(error.message);}
};
async function usePasskey(action) {
  const buttons = [el('passkey-register'),el('passkey-login')];
  buttons.forEach(button => {button.disabled = true;});
  try {
    const start = apiOrigin === pageUrl.origin ? {action} : {action,tabFallback:true};
    const {options,ceremony} = await api('auth/passkey/start',start);
    const response = await obtainPasskey(action,options);
    const result = await api('auth/passkey/finish',ceremony ? {response,ceremony} : {response});
    tabSession = result.tabSession;
    feedback('');await afterLogin();
  } catch (error) {
    const messages = {
      InvalidStateError: 'You already have a passkey. Choose “Use existing passkey”.',
      NotAllowedError: 'Passkey sign-in was cancelled or unavailable. You can try again.',
    };
    el('join-status').textContent = messages[error.name] ?? error.message;
  } finally {buttons.forEach(button => {button.disabled = false;});}
}
el('passkey-register').onclick = () => usePasskey('register');
el('passkey-login').onclick = () => usePasskey('login');
el('auth').onsubmit = async event => {
  event.preventDefault();
  const email = el('email').value.trim();
  const button = el('auth-button');
  button.disabled = true;
  try {
    if (!sentCode) {
      await api('auth/start',{email}); sentCode = true;
      el('email').readOnly = true; el('code-field').hidden = false; el('code').required = true;
      button.textContent = 'Verify code'; el('code').focus(); el('join-status').textContent = 'Check your email for the code.';
    } else {
      await api('auth/verify',{email,code:el('code').value});
      await afterLogin(); feedback('');
    }
  } catch (error) {el('join-status').textContent = error.message;}
  finally {button.disabled = false;}
};
el('prompt').addEventListener('input',updateForm);
el('attempt-form').onsubmit = async event => {
  event.preventDefault();
  if (el('submit').disabled) return;
  const prompt = el('prompt').value;
  const {day,digest} = today.challenge;
  const via = today.share?.day === day ? today.share.id : null;
  if (!today.authenticated) {
    deferredTurn = {prompt,day,digest};
    showDialog('join');
    return;
  }
  if (!retry || retry.prompt !== prompt || retry.day !== day || retry.via !== via) retry = {key:crypto.randomUUID(),prompt,day,digest,via};
  submitting = true; updateForm(); feedback('');
  try {
    const {attempt} = await api('attempt',retry);
    retry = null; el('prompt').value = '';
    if (attempt.status !== 'completed') feedback('This turn is recorded. Check its outcome before retrying.');
  } catch (error) {feedback(error.message);}
  finally {
    try {await refresh();} catch {feedback('Connection interrupted. Check your turns before retrying.');}
    submitting = false; updateForm();
    if (!el('attempts').hidden) el('history').scrollIntoView({block:'nearest'});
  }
};
el('publish-share').onclick = async () => {
  const attempt = selectedAttempt;
  const button = el('publish-share');
  button.disabled = true;
  try {
    const allowReveal = el('allow-reveal').checked;
    const {share} = await api('share',{attemptId:attempt.id,allowReveal});
    attempt.shareId = share.id; attempt.allowReveal = allowReveal;
    const field = el('share-link');
    field.value = dareLink(share.id); field.hidden = false; field.select();
    try {
      const dare = scorecard(share) + '. Can you beat it?';
      if (navigator.share) await navigator.share({title:'Reploid Daily',text:dare,url:field.value});
      else await navigator.clipboard.writeText(dare + '\n' + field.value);
      el('share-status').textContent = navigator.share ? 'Dare ready.' : 'Score and link copied.';
    } catch {el('share-status').textContent = 'Copy this link to send your dare.';}
  } catch (error) {el('share-status').textContent = error.message;}
  finally {button.disabled = false;}
};
el('prompt').closest('form').addEventListener('keydown',event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault();el('attempt-form').requestSubmit();}
});
document.querySelector('.brand').href = invite ? '/#' + new URLSearchParams({invite}) : '/';
if (playerPass) {
  const credential = playerPass; playerPass = null;
  join(credential).catch(async error => {await refresh();feedback(error.message);});
} else refresh().catch(error => {el('status').textContent = error.message;});

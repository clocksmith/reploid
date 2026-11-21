const element = id => document.getElementById(id);
const add = (parent, tag, content, className) => {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  parent.append(node);
  return node;
};
const invite = new URLSearchParams(location.hash.slice(1)).get('invite');
const dareId = new URL(location.href).searchParams.get('share');
let today, submitting = false, sentCode = false, retry = null;
const feedback = message => { element('feedback').textContent = message; };
const wordScore = (words, characters) =>
  words + (words === 1 ? ' word' : ' words') + ' · ' + characters + (characters === 1 ? ' character' : ' characters');

async function api(path, data) {
  const headers = invite ? {'x-circle-invite': invite} : {};
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {method:data ? 'POST' : 'GET', headers, credentials:'same-origin',
    body:data ? JSON.stringify(data) : undefined});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || 'The circle could not finish that request.'), {code:result.error});
  return result;
}
function updateForm() {
  const prompt = element('prompt').value.trim().normalize('NFC');
  const words = prompt.normalize('NFKC').match(/[\p{L}\p{N}]+/gu)?.length || 0;
  const chars = [...prompt].length;
  element('count').textContent = wordScore(words, chars);
  const remaining = Math.max(0,3 - (today?.history?.length || 0));
  element('tries').textContent = today?.authenticated ? remaining + ' of 3 tries left' : '3 tries per day';
  element('submit').disabled = submitting || today?.availability !== 'ready' || !today.authenticated
    || !remaining || !words || chars > 240;
}
function scorecard(share) {
  const edition = share.day.replaceAll('-', '');
  return 'Reploid Daily #' + edition + ' · Got it in ' + share.words
    + (share.words === 1 ? ' word' : ' words') + ' · ' + share.attemptNumber + '/3 tries';
}
function shareUrl(id) {
  const url = new URL('/',location.origin);
  url.searchParams.set('share',id);
  if (invite) url.hash = new URLSearchParams({invite});
  return url.href;
}
function renderAttempts() {
  const history = element('history');
  history.replaceChildren();
  element('attempts').hidden = !today.history.length;
  for (const attempt of today.history) {
    const row = add(history,'article','','attempt');
    const completed = attempt.status === 'completed';
    const label = completed ? (attempt.won ? 'Matched' : 'Missed') : (attempt.status === 'unresolved' ? 'Outcome unresolved' : 'Awaiting result');
    add(row,'strong',label + ' · ' + wordScore(attempt.words,attempt.characters));
    add(row,'p',attempt.prompt);
    if (completed) add(row,'p','Model answer: ' + (attempt.output || '(empty)'));
    if (!attempt.won) continue;
    const consent = add(row,'label','');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(attempt.allowReveal);
    consent.append(checkbox,' Allow the host to review my prompt for tomorrow’s reveal.');
    const button = add(row,'button',attempt.shareId ? 'Get dare link' : 'Share this win');
    button.type = 'button';
    button.addEventListener('click',async () => {
      button.disabled = true;
      try {
        const {share} = await api('/api/share',{attemptId:attempt.id,allowReveal:checkbox.checked});
        const url = shareUrl(share.id);
        let link = row.querySelector('.dare-link');
        if (!link) {
          link = add(row,'input','','dare-link');
          link.readOnly = true;
          link.setAttribute('aria-label','Dare link with the circle invitation');
        }
        link.value = url;
        link.focus();
        link.select();
        const title = scorecard(share) + '. Can you beat it?';
        try {
          if (navigator.share) await navigator.share({title:'Reploid Daily',text:title,url});
          else await navigator.clipboard.writeText(url);
          feedback(navigator.share ? 'Dare ready to share.' : 'Dare link copied.');
        } catch { feedback('Copy the selected dare link to invite a friend.'); }
      } catch (error) { feedback(error.message); }
      finally { button.disabled = false; }
    });
  }
}
function render() {
  const {challenge,share,shareChallenge,history,availability,leaderboard,yesterdayWinners} = today;
  element('date').textContent = challenge?.day ? challenge.day + ' · UTC' : 'Daily challenge · UTC';
  element('circle').textContent = today.circle;
  element('target').textContent = challenge?.target || 'Next puzzle pending';
  element('banned').textContent = challenge?.banned?.length ? 'Without using ' + challenge.banned.map(w => '“' + w + '”').join(', ') + '.' : '';
  element('model').textContent = challenge?.modelId || '';
  element('dare').hidden = !share;
  if (share) {
    element('dare-score').textContent = scorecard(share) + '. '
      + (challenge?.day === share.day ? 'Can you beat it?' : 'Played on ' + share.day + '.');
    element('dare-target').textContent = shareChallenge?.target ? 'Target: ' + shareChallenge.target : '';
    element('dare-output').textContent = share.output;
    element('dare-proof').textContent = today.circle + ' · ' + (shareChallenge?.modelId || 'Recorded model')
      + ' · Receipt ' + share.receiptDigest;
  }
  element('disclosure').textContent = 'The serving computer for ' + today.circle
    + ' can read your prompt. Sharing a win shows your score and the recorded answer.';
  const statuses = {
    'host-full':'The host has served its daily turn budget. Recorded dares are still available.',
    'configuration-changed':'Ranked turns are paused because the host configuration changed. Recorded scores remain available.',
    'invalid-invite':'This invitation has expired or been revoked. Ask the host for a new one.',
    'needs-invite':'Open a circle invitation to take your three turns.',
    staged:'Staged for playtesting. Ranked play opens after this target qualifies on Apple, AMD and the serving GPU.',
    busy:'The host is playing another turn.',
    ready: today.authenticated && history.length >= 3 ? 'You’ve played all three tries. A new challenge starts at midnight UTC.' : '',
  };
  const status = element('status');
  status.replaceChildren(document.createTextNode(statuses[availability] ?? 'This circle is unavailable.'));
  if (availability === 'host-full') {
    status.append(' ');
    const link = add(status,'a','Host your own');
    link.href = '/host.html';
  }
  if (availability === 'busy') {
    status.append(' ');
    const button = add(status,'button','Refresh');
    button.onclick = () => refresh().catch(error => feedback(error.message));
  }
  element('auth').hidden = today.authenticated || !today.inviteValid;
  element('prompt').disabled = availability === 'staged' || !challenge?.qualified;
  const board = element('leaderboard');
  board.replaceChildren();
  for (const score of leaderboard) add(board,'li',wordScore(score.words,score.characters)).value = score.rank;
  element('leader-empty').hidden = leaderboard.length > 0;
  const winners = element('yesterday');
  winners.replaceChildren();
  if (!yesterdayWinners.length) add(winners,'p','No reviewed winning prompts to show.','empty');
  for (const winner of yesterdayWinners) {
    add(winners,'blockquote',winner.prompt,'winner');
    add(winners,'small',wordScore(winner.words,winner.characters));
  }
  for (const own of today.revealChoices) {
    const button = add(winners,'button','Withdraw my prompt: ' + own.prompt);
    button.addEventListener('click',async () => {
      button.disabled = true;
      try {
        await api('/api/share',{attemptId:own.id,allowReveal:false});
        await refresh(); feedback('Your prompt was withdrawn from the reveal.');
      } catch (error) { feedback(error.message); button.disabled = false; }
    });
  }
  renderAttempts();
  updateForm();
}
async function refresh() {
  const state = await api('/api/today' + (dareId ? '?share=' + encodeURIComponent(dareId) : ''));
  today = state;
  render();
}
element('prompt').addEventListener('input',updateForm);
element('attempt-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (element('submit').disabled) return;
  const prompt = element('prompt').value;
  const {day,digest} = today.challenge;
  const via = today.share?.day === day ? today.share.id : null;
  if (!retry || retry.prompt !== prompt || retry.day !== day || retry.via !== via) {
    retry = {key:crypto.randomUUID(),prompt,day,digest,via};
  }
  submitting = true; updateForm(); feedback('Waiting for the circle’s model…');
  try {
    const {attempt} = await api('/api/attempt',retry);
    feedback(attempt.status === 'completed' ? (attempt.won ? 'It matched. Your dare is ready.' : 'That answer missed the target.') : 'This turn is already recorded.');
    retry = null; element('prompt').value = '';
  } catch (error) { feedback(error.message); }
  finally {
    try { await refresh(); } catch { feedback('Connection interrupted. Refresh to check your history before retrying.'); }
    submitting = false; updateForm();
  }
});
element('auth').addEventListener('submit',async event => {
  event.preventDefault();
  const email = element('email').value.trim();
  const button = element('auth-button');
  button.disabled = true;
  try {
    if (!sentCode) {
      await api('/api/auth/start',{email});
      sentCode = true; element('email').readOnly = true; element('code-field').hidden = false;
      element('code').required = true; button.textContent = 'Verify code'; element('code').focus();
      feedback('Enter the code from your email.');
    } else {
      await api('/api/auth/verify',{email,code:element('code').value});
      await refresh(); feedback('Signed in. Your turns are ready.');
      element('prompt').focus();
    }
  } catch (error) { feedback(error.message); }
  finally { button.disabled = false; }
});
document.querySelector('a[href="#rules"]').addEventListener('click',event => {
  event.preventDefault(); element('rules').scrollIntoView();
});
document.querySelector('.brand').href = invite ? '/#' + new URLSearchParams({invite}) : '/';
refresh().catch(error => { element('status').textContent = error.message; });

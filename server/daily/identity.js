// This circle uses its operator's Supabase email OTP project. Only the verified
// stable subject reaches the score store. The email, OTP and access token do not.
export function createEmailIdentity({projectUrl, publishableKey, fetchImpl = fetch}) {
  const origin = new URL(projectUrl);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
    || origin.username || origin.password || !publishableKey) throw new Error('Configure an HTTPS email sign-in project and its publishable key.');
  const auth = origin.origin + '/auth/v1';
  async function request(path, payload, accessToken) {
    const response = await fetchImpl(auth + path, {
      method: payload ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: {apikey: publishableKey, 'Content-Type': 'application/json',
        ...(accessToken ? {Authorization: 'Bearer ' + accessToken} : {})},
      ...(payload ? {body: JSON.stringify(payload)} : {}),
    });
    if (!response.ok) {
      let status = 401;
      if (response.status === 429) status = 429;
      else if (response.status >= 500) status = 503;
      throw Object.assign(new Error('Email sign-in was unsuccessful. Check the code or try again later.'), {
        code: 'email_sign_in_failed', status,
      });
    }
    return response;
  }
  function address(email) {
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw Object.assign(new Error('Enter a valid email address.'), {code:'invalid_email', status:400});
    }
    return email.trim().toLowerCase();
  }
  return {
    async start(email) { await request('/otp', {email:address(email), create_user:true}); },
    async verify(email, code) {
      email = address(email);
      if (typeof code !== 'string' || !/^\d{6,10}$/.test(code)) {
        throw Object.assign(new Error('Enter the numeric code from your email.'), {code:'invalid_code',status:400});
      }
      const session = await (await request('/verify',{email,token:code,type:'email'})).json();
      if (typeof session.access_token !== 'string' || !session.access_token) throw new Error('Missing verified session.');
      const user = await (await request('/user',null,session.access_token)).json();
      if (user.is_anonymous || !user.email_confirmed_at || typeof user.id !== 'string' || !user.id
        || typeof user.email !== 'string' || user.email.toLowerCase() !== email) {
        throw Object.assign(new Error('A verified email account is required.'), {code:'unverified_account',status:401});
      }
      return origin.origin + '/user/' + user.id;
    },
  };
}

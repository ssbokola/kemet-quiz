const KEY = 'kemet-quiz-admin-pw';

export function getAdminPassword() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminPassword(pw) {
  try {
    if (pw) sessionStorage.setItem(KEY, pw);
    else sessionStorage.removeItem(KEY);
  } catch {}
}

/** fetch avec le mot de passe formateur en en-tête. */
export function adminFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const pw = getAdminPassword();
  if (pw) headers['x-admin-password'] = pw;
  return fetch(url, { ...options, headers });
}

export async function checkAdminPassword(pw) {
  const res = await fetch('/api/admin/check', {
    method: 'POST',
    headers: { 'x-admin-password': pw },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Mot de passe incorrect');
  }
  return res.json();
}

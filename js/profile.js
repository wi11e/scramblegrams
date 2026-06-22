const KEY = 'sg-profile';

export const COUNTRIES = [
  'AU','AT','BE','BR','CA','CL','CN','CO','CZ','DK',
  'EG','FI','FR','DE','GH','GR','HK','HU','IN','ID',
  'IE','IL','IT','JP','KE','KR','MY','MX','NL','NZ',
  'NG','NO','PK','PH','PL','PT','RO','RU','SA','SG',
  'ZA','ES','SE','CH','TW','TH','TR','UA','AE','GB','US',
];

export function flagEmoji(code) {
  return [...code.toUpperCase()].map(c =>
    String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)
  ).join('');
}

export function getProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveProfile(playerName, countryCode) {
  localStorage.setItem(KEY, JSON.stringify({ playerName, countryCode }));
}

export function hasProfile() {
  return getProfile() !== null;
}

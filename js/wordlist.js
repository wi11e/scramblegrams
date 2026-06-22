let _words = null;

export async function loadWordList() {
  const res = await fetch('./wordlist.txt');
  const text = await res.text();
  _words = new Set(text.split('\n').filter(Boolean));
}

export function isValidWord(w) {
  return _words !== null && _words.has(w.toUpperCase());
}

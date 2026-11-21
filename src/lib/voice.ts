// Konuşarak yazmada sözlü noktalama komutları ("virgül", "nokta", "yeni satır"…)
const PHRASES: [string[], string][] = [
  [['yeni', 'satır'], '\n'], [['alt', 'satır'], '\n'], [['soru', 'işareti'], '?'], [['ünlem', 'işareti'], '!'],
  [['iki', 'nokta'], ':'], [['ünlem'], '!'], [['virgül'], ','], [['nokta'], '.'],
];

/** Sözlü noktalama komutlarını işarete çevirir */
export function applyVoiceCommands(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let out = '';
  for (let i = 0; i < words.length; ) {
    const hit = PHRASES.find(([p]) => p.every((w, j) => words[i + j]?.toLocaleLowerCase('tr').replace(/[.,!?]$/, '') === w));
    if (hit) {
      out = hit[1] === '\n' ? out.trimEnd() + '\n' : out.trimEnd() + hit[1];
      i += hit[0].length;
    } else {
      out += (out && !out.endsWith('\n') ? ' ' : '') + words[i];
      i += 1;
    }
  }
  return out.trim();
}


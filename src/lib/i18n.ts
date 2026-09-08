import { createContext, useContext } from 'react';
import en, { type Dict } from './locales/en';
import it from './locales/it';
import es from './locales/es';
import fr from './locales/fr';
import de from './locales/de';
import pt from './locales/pt';
import ru from './locales/ru';

export type Lang = 'en' | 'it' | 'es' | 'fr' | 'de' | 'pt' | 'ru';

/** Every language is named in its own language, which is how people find theirs. */
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
];

const DICTS: Record<Lang, Dict> = { en, it, es, fr, de, pt, ru };

export type TKey = keyof Dict;
export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && value in DICTS;
}

/** Maps a system locale such as "pt-BR" or "it-IT" onto a language we ship. */
export function closestLang(locale: string | undefined): Lang {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : 'en';
}

/**
 * Looks a key up in the chosen language, falling back to English when a string
 * is missing. Every dictionary is typed against English, so a gap is a build
 * error rather than a runtime hole, but the fallback keeps a hand-edited or
 * partially loaded dictionary from blanking the interface.
 */
export function translator(lang: Lang): Translate {
  const dict = DICTS[lang] ?? en;
  return (key, vars) => {
    const template = dict[key] ?? en[key] ?? String(key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in vars ? String(vars[name]) : whole,
    );
  };
}

export const I18nContext = createContext<{ lang: Lang; t: Translate }>({
  lang: 'en',
  t: translator('en'),
});

export function useT(): Translate {
  return useContext(I18nContext).t;
}

export function useLang(): Lang {
  return useContext(I18nContext).lang;
}

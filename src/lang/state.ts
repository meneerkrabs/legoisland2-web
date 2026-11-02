// Which language this session plays in. Tiny on purpose (no imports): the preference lives in src/display.ts, the files in src/lang/source.ts; the language that is really in use (the
// player's choice may fall back to Dutch when the pack cannot be read) is recorded here by main.ts so that code which depends on the language (the optional "Herstelde inhoud" mode,
// whose subtitles are Dutch transcripts) can ask without importing the file layer.
export type ActiveLang = 'nl' | 'en';
let active: ActiveLang = 'nl';
export const setActiveLanguage = (l: ActiveLang) => { active = l; };
export const activeLanguage = (): ActiveLang => active;

// Subtitle texts for the speech clips that have audio but no text in the original game.
// Transcription = authored by this project (typed from whisper large-v3-turbo / large-v3 transcripts,
// D1 of docs/re/restore-plan.md); the audio itself is not stored here. Where a sibling line exists in a
// .str file, that wording and spelling ("LEGO eiland", "Res-Q", "Space Port", "Super-stationschef") is followed.
// Certainty per line: docs/re/unused.md 7.7. CACSFH02/03/06 are byte-for-byte the shipped CACSHF02/03/06 recordings (official text);
// ALT takes follow their table sibling; the rest was settled by Whisper large-v3 teacher-forced scoring + a Dutch wav2vec2 CTC model + the English dub's meaning.
// Lines flagged in DOUBTFUL_LINES below: listen once and correct if needed.
// Keys: mp3 base name, upper case, as in sounds/speech/Data (three names contain a space).
// Not included: 'OGSGPO11_NL ALTERNAT' (a scream, no words).

export const ORPHAN_LINES: Record<string, string> = {
  ADCSAM05: 'Dr. Pepper?',
  ADCSAM06: 'Nee, gewoon Pepper.',
  ADSGDS07ALT: 'Oeps, autorijden is toch niet helemaal hetzelfde als skaten?',
  ADSGSS01_: 'Mooi werk Pepper, geen enkele slang is aan je ontsnapt.',
  ADSGSS01_NLB: 'Mooi werk Pepper, geen enkele slang is aan je aandacht ontsnapt.',
  ADSGTR01_: 'Je hebt een Tyrannosaurus Rex bereden en het leek wel of je je hele leven niks anders hebt gedaan.',
  ADSGWS07: 'Slangen slaan en spullen halen, edelstenen of zoiets, dacht ik.',
  BALBAA01: 'Het is hier veel te stil geweest sinds die brug kapot is.',
  CACSFH02: 'En roep deze dag uit tot Pepperdag vanwege zijn edele overwinning op de zwarte ridder van de Stieren.',
  CACSFH03: 'Een hoeraatje voor Pepper, Hieper de piep',
  CACSFH06: 'Goed gevangen! Enne trouwens, die toernooi-uitrusting was wel in bruikleen hoor. Lever maar in bij de uitgang.',
  CAROAA07: 'Als je nog eens langskomt, ben ik misschien wel een ridder.',
  CARQBB04ALT1: 'Simon zal wel gauw weer een list verzinnen.',
  LEBBPH02B: 'Hij schiet. Hij scoort.',
  LEBBPM06B: 'Mis!',
  LEBEAA07: 'Noodgeval! Niks te maken! Ik moet wat maken!',
  LECCAA20: 'Leuk je te zien, maatje!',
  LECCBB20: 'Ga zo vlug als je kunt naar het politiebureau.',
  LECSBE20B: 'Ho!',
  LEDTHT03: 'Zag je dat? Het is gelukt! Ik heb die konijnensprong in de lucht gedaan!',
  LEDTHT04: 'Wat zou er gebeuren als ze nou eens allemaal tegelijk in de lucht sprongen?',
  LEDTHT05: 'Nou nou, jij hebt het zeker druk, kleintje.',
  LEDTHT06: 'Ik hoorde dat jij thuis een geweldige cd-verzameling hebt. Als je helemaal gek wordt, moet je lekker relaxen met muziek.',
  LEDTHT11: 'Hé joh, er zijn hele mooie auto\'s op LEGO eiland.',
  LEDTHT12: 'Maar als je de kleur niet mooi vindt, spuit je ze gewoon over.',
  LEDTHT13: 'Hé vriend, ik heb gehoord dat je een filmavond gaat houden bij jou thuis. Wat voor soort films heb je?',
  LEDTHT14: 'Heb je ook popcorn met pizzasmaak?',
  LEDTHT15: 'Yo Pepper, zin om LEGO eiland een metamorfose te geven?',
  LEDTHT16: 'Als je een creatieve bui hebt, moet je zijn ontwerp voor de tuin proberen.',
  LEDTHT21: 'Hoi Pepper, ben je weer in verre landen geweest? Er was vast heel veel te zien.',
  LEDTHT22: 'Je weet nooit wat je vindt, maar als je hard genoeg zoekt...',
  LEDTHT23: 'Hé skater, pas op bij die spoorlijnen, tenzij je een trein bent natuurlijk.',
  LEDTHT24: 'Dat is een hele snelle manier van reizen. Bijna net zo snel als de Super-stationschef.',
  LEDTHT27: 'Heb je die zilveren Brickbots gezien, Pepper?',
  LEDTHT28: 'Ik heb een paar van die Brickbots al eens zien dansen. Jeetje, wat houden die van muziek, zeg!',
  LEDTHT29: 'Hoi pizzaman, blijf hier even relaxen, joh!',
  LEDTHT30: 'Het is altijd leuk om met mensen te praten. Je weet maar nooit wat ze je kunnen vertellen. Kom nog eens langs.',
  LEDTHT31: 'Hoi Pepper, hoe heb je me hier gevonden? Ik ben aan het schuilen voor de zon. Tjonge, wat is het heet!',
  LEDTHT32: 'Pas op in donkere hoekjes als deze, maar houd je ogen goed open. Je weet maar nooit wat er zich allemaal in een tunnel kan verstoppen.',
  LEDTHT33: 'Hé kleintje, hoe vind je mijn nieuwe auto?',
  LEDTHT34: 'Dit weet je vast al, maar als je in een voertuig wilt zitten, hoef je er maar in te springen.',
  LEDTHT35: 'Hé, heb jij ooit in een helikopter gevlogen?',
  LEDTHT36: 'Stap maar in als je het eens wilt proberen.',
  LEDTHT37: 'Lekker zeg! Op een jetski kun je supersnel rondcrossen.',
  LEDTHT38: 'Probeer het ook eens. Spring er maar op!',
  LEDTHT39: 'Valerie is altijd in een oogwenk ter plaatse in haar speedboot.',
  LEDTHT40: 'Spring er maar gewoon in als je een boot wilt gebruiken.',
  LEDTHT41: 'Hé Pepper, kom lekker meefeesten. Dit huis swingt echt de pan uit.',
  LEDTHT42: 'Iedereen houdt van muziek. Sommige mensen gaan overal met de muziek mee.',
  LEFMAA21: 'Hé joh, blijf nou doorgaan!',
  LEFMBB21: 'Helemaal naar het Res-Q hoofdkwartier.',
  LEGFAA24: 'Oh Pepper, we zijn je allemaal dankverschuldigd.',
  LEGFAA25: 'Je bent hier altijd welkom.',
  LEGFBB15ALT: 'Ga nu nog niet weg, Pepper. Je kunt nog veel plezier beleven op LEGO eiland.',
  LEGFBB24: 'Blijf nog even, Pepper. Nu Dondersteen achter slot en grendel zit, kunnen we meer plezier beleven dan ooit.',
  'LEGPAA08 ALT': 'Pepper, heb jij mijn bladzijde toevallig al gevonden?',
  LEPHAA03: 'Hai Pepper, en lekker aan het joggen zie ik?',   // checked by ear
  LEPHAA04: 'Pepper, je bent klaar met je ronde.',
  'LEPHBB05 ALT': 'Uit onderzoek blijkt dat het nieuwe gebouw JOUW huis is!',
  LERSAA21: 'Pepper, wat een verrassing!',
  LERSBB23: 'Je moet naar het radiostation. Dat is leuk!',
  LESBAA20: 'Mooie stereo, pizzaman!',
  LESBBB21: 'De politie heeft naar je gevraagd, Pepper.',
  LESPAA22: 'Pepper, leuk je te zien!',
  LESPBB22: 'Jij hebt duidelijk actie nodig.',
  LESPBB23: 'Naar de Space Port en snel!',
};

// Not fully settled (models split, or the clip assignment itself is a reconstruction): listen to these once. LEPHAA03 was settled by ear, LEDTHT16 by candidate scoring + the CTC path (no 'o' vowel: not "zo'n").
export const DOUBTFUL_LINES: string[] = [
  'ADCSAM06',
  'CARQBB04ALT1',
  'LEDTHT37',
  'LEDTHT38',
  'LEDTHT41',
  'LEBEAA07',   // voicefix (TBOBA): wording settled by scoring ("maken"); the speaker assignment is a reconstruction
];

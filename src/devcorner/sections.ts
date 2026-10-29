// The 12 sections in tab order. Each file exports `section: SectionDef`.
import type { SectionDef } from './types.ts';
import { section as springen } from './springen.ts';
import { section as variabelen } from './variabelen.ts';
import { section as cheats } from './cheats.ts';
import { section as camera } from './camera.ts';
import { section as records } from './records.ts';
import { section as modellen } from './modellen.ts';
import { section as texturen } from './texturen.ts';
import { section as geluid } from './geluid.ts';
import { section as teksten } from './teksten.ts';
import { section as scenes } from './scenes.ts';
import { section as vliegen } from './vliegen.ts';
import { section as over } from './over.ts';

export const SECTIONS: SectionDef[] = [springen, variabelen, cheats, camera, records, modellen, texturen, geluid, teksten, scenes, vliegen, over];

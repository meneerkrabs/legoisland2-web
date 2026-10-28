// The behaviour nodes of the engine core, registered by the name of the original constructor / source file so zone set-ups can attach them declaratively
// (attachNode(rec, 'SGwalk', 1, V.PEPPER_CONTROL, 1, 1)). Later milestones register theirs next to these.
import { registerNode } from './controller.ts';
import { WalkNode } from './walk.ts';
import { SwimNode, PepSwitchNode } from './swim.ts';
import './walker.ts';   // registers 'Walker'

registerNode('SGwalk', () => new WalkNode());
registerNode('sgswim', () => new SwimNode());
registerNode('PepSwitc', () => new PepSwitchNode());

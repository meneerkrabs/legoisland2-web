#!/usr/bin/env node
// The device check of the start-screen option "HD-textures" (src/mods/hd.ts judgeCapability): which devices get the box checked by default.
//   node tools/test-hd.mjs
import { judgeCapability, HD_NEEDS, HD_NEEDS_LAZY } from '../src/mods/hd.ts';

const fail = [];
const expect = (name, cond, extra = '') => { console.log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
const desktop = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36', touchPrimary: false, persistent: true, room: 10e9, deviceMemory: 8 };
const ok = (e, needs) => judgeCapability({ ...desktop, ...e }, needs);

expect('desktop with 8 GB and 10 GB free: on', ok({}).ok);
expect('desktop that does not report memory (Safari / Firefox): on', ok({ deviceMemory: undefined }).ok);
expect('iPhone UA: off, with a reason', !ok({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' }).ok && ok({ userAgent: 'iPhone Mobile' }).reason.includes('telefoons'));
expect('Android UA: off', !ok({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' }).ok);
expect('userAgentData.mobile: off', !ok({ mobileHint: true }).ok);
expect('touch-primary device (iPadOS posing as a Mac): off', !ok({ touchPrimary: true }).ok);
expect('4 GB of memory: off', !ok({ deviceMemory: 4 }).ok);
expect('2 GB of memory: off', !ok({ deviceMemory: 2 }).ok);
expect('no persistent store: off', !ok({ persistent: false }).ok);
expect('500 MB free: off for both sources', !ok({ room: 500e6 }, HD_NEEDS_LAZY).ok && !ok({ room: 500e6 }, HD_NEEDS).ok);
expect('2 GB free: on for archive.org on demand, off for the MEGA whole pack', ok({ room: 2e9 }, HD_NEEDS_LAZY).ok && !ok({ room: 2e9 }, HD_NEEDS).ok);
expect('unknown quota: on', ok({ room: null }).ok);
expect('the reasons are Dutch and say it can still be turned on', !ok({ deviceMemory: 4 }).ok && /Standaard uit/.test(ok({ deviceMemory: 4 }).reason));
console.log(fail.length ? `${fail.length} failed` : 'all ok');
process.exit(fail.length ? 1 : 0);

#!/usr/bin/env node
// The device check of the start-screen option "HD-textures" (src/mods/hd.ts judgeCapability): which devices get the box checked by default.
//   node tools/test-hd.mjs
import { judgeCapability, HD_NEEDS, HD_NEEDS_LAZY } from '../src/mods/hd.ts';
import { isIPadOs, looksMobile } from '../src/compat.ts';

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
// browsers without deviceMemory / userAgentData (Safari, Firefox): few cores and no memory report -> off; an iPad that reports itself as a Mac is a tablet
expect('no memory report and 2 cores: off', !ok({ deviceMemory: undefined, cores: 2 }).ok);
expect('no memory report and 8 cores: on', ok({ deviceMemory: undefined, cores: 8 }).ok);
expect('a memory report wins over the cores (Chromium)', ok({ deviceMemory: 8, cores: 2 }).ok);
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
expect('iPadOS (Macintosh UA, 5 touch points) is a tablet', isIPadOs({ userAgent: mac, maxTouchPoints: 5 }) && looksMobile({ userAgent: mac, maxTouchPoints: 5 }));
expect('a real Mac (0 touch points) is not', !isIPadOs({ userAgent: mac, maxTouchPoints: 0 }) && !looksMobile({ userAgent: mac, maxTouchPoints: 0 }));
expect('Firefox desktop is not', !looksMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:157.0) Gecko/20100101 Firefox/157.0', maxTouchPoints: 0 }));
expect('client hints mobile is', looksMobile({ userAgent: 'x', maxTouchPoints: 0, userAgentData: { mobile: true } }));
console.log(fail.length ? `${fail.length} failed` : 'all ok');
process.exit(fail.length ? 1 : 0);

// The island's audio (tools/steps/audio-island.mjs: sea loop, listener, music keys) per engine. The zone URL has no start-screen click, so a click on the page unlocks the audio first (a real player pressed Spelen):
//   node tools/browse.mjs "http://localhost:5497/?zone=z02LGI" tools/steps/browser-audio-island.mjs --browser webkit --size 800x600      (no mute=1: that switches the engine off)
import inner from './audio-island.mjs';
export default async (h) => {
  await h.page.waitForSelector('canvas');
  await h.wait(1500);
  await h.page.mouse.click(400, 300);
  await inner(h);
};

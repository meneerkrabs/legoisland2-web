// The island's audio in the headless, muted browser (do NOT pass mute=1): the zone's sound list is loaded before the first frame, the sea loop (SND_LGI_SEA 0x125) plays
// at the shore point of the +-400 square, the listener follows the camera, the music keys of the Music node are loaded and the first one is scheduled one prepare time after
// it was asked for, notifications reach the node.
//   (sh tools/m4-snapshot-server.sh 5612)   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5612/?zone=z02LGI" tools/steps/audio-island.mjs --size 800x600
export default async ({ page, wait, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 240000 });
  await wait(Number(process.env.WAIT_MS ?? 9000));   // WAIT_MS=90000: long enough for Z02LGIT to loop once and the Music node to switch to Z02LGIM
  const r = await page.evaluate(() => {
    const a = window.__shell.audio, ga = a.ga, z = window.__zone, l = ga.ctx.listener;
    const sea = a.slot('3d', 0x125);
    const pep = z.world.records.find((rec) => rec && rec.ctrl && rec.ctrl.nodes.some((n) => n.kind === 'PepSwitc'));
    return {
      mode: z.machine.mode,
      lists: { d2: ga.sfx.slotCounts.d2, d3: ga.sfx.slotCounts.d3 },
      hostLog: a.log.map((e) => `${e.t.toFixed(2)} ${e.what} ${e.detail ?? ''}`),
      musicLog: ga.music.log.map((e) => `${e.t.toFixed(2)} ${e.what} ${e.key ?? ''}${e.at !== undefined ? ' at ' + e.at.toFixed(2) : ''}${e.value !== undefined ? ' ' + e.value : ''}`),
      sea: sea ? { playing: sea.playing, maxDist: sea.maxDist, buffer: !!sea.buffer } : null,
      pepper: pep ? [pep.x, pep.y, pep.z] : null,
      listener: l.positionX ? [l.positionX.value, l.positionY.value, l.positionZ.value] : null,
      camera: Array.from(z.world.camera.c.slice(0, 6)),
      missed: [...a.missed],
      stats: a.stats,
      voices: ga.sfx.activeVoices,
    };
  });
  log('AUDIO-ISLAND ' + JSON.stringify(r));
};

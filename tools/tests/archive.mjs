export default {
  name: 'archive',
  run(ctx) {
    const failures = []; let checked = 0;
    for (const a of ctx.archives) {
      let end = 0;
      const sorted = [...a.entries].sort((x, y) => x.offset - y.offset);
      for (const e of sorted) {
        checked++;
        if (!a.markerOk(e)) failures.push(`${e.fullPath}: missing FILE marker`);
        if (e.offset - 4 < end) failures.push(`${e.fullPath}: overlaps previous member`);
        else if (e.offset - 4 > end) failures.push(`${e.fullPath}: ${e.offset - 4 - end} unaccounted bytes before the member`);
        end = e.offset + e.size;
      }
      if (end !== a.bob.length) failures.push(`${a.name}: members end at ${end}, blob is ${a.bob.length}`);
    }
    return { checked, failures };
  },
};

// Audio: the island's sea loop position (src/audio/sea.ts) against a literal transcription of the decompiled branches (LE2.c 78269-78367: the end of FUN_004bb67d).
import { lgiSeaPosition } from '../../src/audio/sea.ts';

/** the C block, mechanically converted (tools: sed over LE2.c, `(float)` casts dropped): inputs local_28 = x, local_20 = z, DAT_009da858 = sea level */
function oracle(local_28, local_20, DAT_009da858) {
  const local_30 = 400;
  const local_7c = [0, 0, 0, 0];
  let local_38, local_3c, local_34, local_6c, local_68, local_64, local_60;
  local_38 = DAT_009da858;
  if ((local_28 < 0) || (local_20 < 0)) {
    if ((local_28 < 0) || (0 <= local_20)) {
      if ((0 <= local_28) || (local_20 < 0)) {
        if (-local_20 < -local_28) {
          local_7c[1] = -local_30;
          if (local_28 <= local_7c[1]) {
            local_3c = local_28;
          }
          else {
            local_7c[0] = -local_30;
            local_3c = local_7c[0];
          }
          local_34 = local_20;
        }
        else {
          local_3c = local_28;
          local_7c[3] = -local_30;
          if (local_20 <= local_7c[3]) {
            local_34 = local_20;
          }
          else {
            local_7c[2] = -local_30;
            local_34 = local_7c[2];
          }
        }
      }
      else if (local_20 < -local_28) {
        local_68 = -local_30;
        if (local_28 <= local_68) {
          local_3c = local_28;
        }
        else {
          local_6c = -local_30;
          local_3c = local_6c;
        }
        local_34 = local_20;
      }
      else {
        local_3c = local_28;
        if (local_30 <= local_20) {
          local_34 = local_20;
        }
        else {
          local_34 = local_30;
        }
      }
    }
    else if (-local_20 < local_28) {
      if (local_30 <= local_28) {
        local_3c = local_28;
      }
      else {
        local_3c = local_30;
      }
      local_34 = local_20;
    }
    else {
      local_3c = local_28;
      local_60 = -local_30;
      if (local_20 <= local_60) {
        local_34 = local_20;
      }
      else {
        local_64 = -local_30;
        local_34 = local_64;
      }
    }
  }
  else if (local_20 < local_28) {
    if (local_30 <= local_28) {
      local_3c = local_28;
    }
    else {
      local_3c = local_30;
    }
    local_34 = local_20;
  }
  else {
    local_3c = local_28;
    if (local_30 <= local_20) {
      local_34 = local_20;
    }
    else {
      local_34 = local_30;
    }
  }
  return [local_3c, local_38, local_34];
}

export default {
  name: 'audio-sea',
  run() {
    const failures = [];
    let checked = 0;
    const vals = [-1000, -801, -400.5, -400, -399.5, -250, -100.5, -1, -0.0, 0, 0.5, 1, 100, 250, 399.5, 400, 400.5, 401, 800, 1000, 123.25, -123.25];
    for (const x of vals) for (const z of vals) {
      checked++;
      const a = oracle(x, z, -3.5), b = lgiSeaPosition(x, z, -3.5);
      if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) failures.push(`(${x}, ${z}): decompile ${a} port ${b}`);
    }
    return { checked, failures };
  },
};

// The game models that are (versions of) LDraw OMR sets (docs/re/lego3d.md section 3.3, from the recon of every zone: each confirmed by measurement and by eye).
// per model: the OMR set and the sub-model (`entry`) that is the vehicle, the sub-models to leave out, where the game carries it (archive -> LOD meshes in LOD order), a rotation hint of the fit (else all 24 are tried).
// The far mesh that the record's .col file is made from (the last LOD of the record) is never listed here: the collision stays what it is drawn as. A LOD is replaced only when the build gets within the
// ceiling (4.5x the game's triangles of that mesh, 5.2x when nothing smaller exists; LOD 0 at least 1600); a LOD that cannot get there keeps the game's mesh (pack/sets.mjs).
// spec options: stretch ('uniform' | 'axes': a scale fit after the rigid one), gap (distance in game units within which the new hull counts as covering the player's own surface, default 0.4),
// keepTextures (the groups with these texture ids stay the player's).
export const SETS = [
  { key: 'jetski', set: '6415', title: 'Res-Q Jet-Ski', skip: /minifig/i,
    archives: { z02LGI: ['Jetski_group1', 'Jetski_group2', 'Jetski_group3', 'Jetski_group4'], z07CSI: ['Jetski_group1', 'Jetski_group2', 'Jetski_group3', 'Jetski_group4'] } },
  { key: 'ambulance', set: '6666', title: 'Ambulance', skip: /minifig|stretcher/i,
    archives: { z02LGI: ['Ambulance_lod1', 'Ambulance_lod2'] } },
  { key: 'speedster', set: '5920', title: 'Island Racer', entry: 'car.ldr', skip: /minifig/i,
    archives: { z02LGI: ['speedster_red_lod1', 'speedster_red_lod2'], z16PYA: ['speedster_red_lod1', 'speedster_red_lod2'] } },
  { key: 'speedboat', set: '6479', title: 'Emergency Response Centre (boat)', entry: 'boat.ldr', skip: /minifig/i,
    archives: { z02LGI: ['speedboat_group1', 'speedboat_group2', 'speedboat_group3', 'speedboat_group4'], z07CSI: ['speedboat_group1', 'speedboat_group2', 'speedboat_group3', 'speedboat_group4'] } },
  { key: 'heli_resq', set: '6479', title: 'Emergency Response Centre (helicopter)', entry: 'helicopter.ldr', skip: /minifig/i,
    archives: { z02LGI: ['Heli_resq_lod1', 'Heli_resq_lod2'], z13CAI: ['Heli_resq_lod1', 'Heli_resq_lod2'], z14OSD: ['Heli_resq_lod1', 'Heli_resq_lod2'] } },
  { key: 'dingy', set: '6479', title: 'Emergency Response Centre (inflatable boat)', entry: 'inflatable boat.ldr', skip: /minifig/i,
    archives: { z02LGI: ['Dingy_group1', 'Dingy_group2'], z07CSI: ['Dingy_group1', 'Dingy_group2'] } },
  { key: 'locomotive', set: '7750', title: 'Steam Engine (locomotive)', entry: 'locomotive.ldr', skip: /minifig|hose/i,
    archives: { z02LGI: ['locomotive_lod1', 'locomotive_lod2', 'locomotive_lod3', 'locomotive_lod4'] } },
  // the tender: the set's open trailer; the game's is closed (a lid) - the lid stays the player's own triangles (gap filling at run time)
  { key: 'tender', set: '7750', title: 'Steam Engine (tender)', entry: 'trailer.ldr', skip: /minifig|hose/i, gap: 0.2,
    // the set's wagon is an open frame, the game's tender a closed green box: the green groups (texture ids of the game's tender) stay the player's, chassis / wheels / buffers come from the set
    keepTextures: [286, 281, 287, 291],
    archives: { z02LGI: ['loco_tender_lod1', 'loco_tender_lod2', 'loco_tender_lod3', 'loco_tender_lod4'] } },
  // z22BIP: the game's plane is the set scaled up (uniform 1.33: the stud pitch is 1.33x the set's, as the game's own model has it)
  { key: 'seaplane22', set: '5935', title: 'Island Hopper (zone z22BIP, 1.33x)', entry: 'plane.ldr', skip: /minifig|jet|skie/i, stretch: 'uniform',
    archives: { z22BIP: ['seaplane'] } },
  { key: 'seaplane', set: '5935', title: 'Island Hopper', entry: 'plane.ldr', skip: /minifig|jet|skie/i,
    archives: { z38PAR: ['seaplane'] } },
];
// per LOD (mesh order of the model): res of the first try, stud sides at most, budget (x the game's triangles of the mesh), the ladder of collapse costs (squared deviation in game units: 0.02 = 0.14, 0.15 = 0.39)
export const LOD_POLICY = [
  { res: 'std', studs: 12, budget: 2.2, costs: [2e-2, 8e-2] },
  { res: 'low', studs: 0, budget: 1.0, costs: [4e-2, 1.5e-1] },
  { res: 'low', studs: 0, budget: 1.0, costs: [1e-1, 2.5e-1] },
  { res: 'low', studs: 0, budget: 1.0, costs: [2e-1, 4e-1] },
];

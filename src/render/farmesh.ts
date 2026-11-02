// Distance level of detail for the 3D studs of the LEGO 3D option (docs/re/lego3d.md section 12, round 3). A model with ONE level of detail (jetties, bridge sections ...) carries its 3D studs at every distance;
// the generator therefore also puts the player's own, stud-less mesh into the archive as `lego3d/far/<member>`, and the renderer draws that twin once the studs are under a pixel high.
// Without the option nothing sets `on` (it stays false) and the renderer's loop does not look at any of this.
export const FAR_PREFIX = 'lego3d/far/';
export const farMeshes = {
  /** set by the LEGO 3D runtime when an archive of the zone carries far twins */
  on: false,
  /** height of a stud in world units (STUD.height x the usual 1.0 pitch of the plates; studs are 0.2 high): a stud under one pixel high contributes nothing the painted stud does not show */
  studHeight: 0.2,
};

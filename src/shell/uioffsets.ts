// The text offsets of the menu / panel code, DAT_008a9918 (title) and DAT_008a991c (rows). They are GLOBALS of the executable, not per menu: the start-up values (14 and -4) are
// replaced by FUN_004201aa (0x12 and -2), and nothing ever writes the old values back. FUN_004201aa is reached through FUN_0041c080, which the front end's stage set-up
// (FUN_00471070, its last call), every zone loop and the pause trigger of FUN_00423170 call before they open a menu or a panel, and directly by the pause menu of the information
// center (FUN_0054b968) and Pepper's computer (FUN_0053fed3). So every menu, intro / help / banner panel and dialog of a normal session is drawn with 0x12 / -2; only the code that
// runs before the first call of FUN_004201aa (a zone entered without the front end) sees 14 / -4. The panel code (FUN_00460947 ..) and the menu code (FUN_0041c835 ..) read them.
// docs/re/gaps.md U4.
export const uiOffsets = {
  /** DAT_008a9918: y offset of the page title (and of the help panel's title) */
  titleDy: 14,
  /** DAT_008a991c: y offset of the row texts (and of the panels' PRESS line and help rows) */
  itemDy: -4,
};
/** the executable's start-up values (the initialised data) */
export function resetUiOffsets() { uiOffsets.titleDy = 14; uiOffsets.itemDy = -4; }
/** FUN_004201aa (via FUN_0041c080): the values every menu and panel is drawn with from now on */
export function applyUiOffsets() { uiOffsets.titleDy = 0x12; uiOffsets.itemDy = -2; }

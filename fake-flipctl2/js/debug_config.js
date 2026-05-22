/**
 * debug_config.js
 *
 * LOCAL-ONLY developer config. Gitignored — see the project's
 * `.gitignore`. Set `enabled: true` to make `main.js` push a
 * specific scene on top of Desktop on page load, so each
 * refresh drops you straight into the scene you're iterating
 * on instead of forcing you to navigate from the main menu.
 *
 * `scene` matches a friendly name in `DEBUG_SCENE_MAP` over in
 * `main.js`. Mirrors the labels in the Testing / Apps
 * submenus so you can copy-paste the path you'd take by hand.
 * Current supported values:
 *
 *   'On screen keyboard'   — KeyboardTestScene
 *   'Touchpad'             — TouchpadTestScene
 *   'Touchpad ABS'         — TouchpadAbsScene
 *   'Network LEDs'         — NetworkLedsScene
 *   'Screen'               — ScreenTestScene
 *   'Voice recorder'       — VoiceRecorderScene
 *   'Internet radio'       — InternetRadioScene
 *   'Wi-Fi'                — WifiScene
 *
 * Add more by extending `DEBUG_SCENE_MAP` in main.js. The
 * lookup is friendly-name → factory so the strings in this
 * file stay readable.
 */
var DEBUG_CONFIG = {
    enabled: true,
    scene:   'Voice recorder'
};

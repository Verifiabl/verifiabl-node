import QRCode from "qrcode";
import {
  type BarcodeParts,
  buildScanUrl,
  type ScanUrlOptions,
  type VerifiablEnvironment,
} from "../payload.js";

/**
 * Branded "Secured by Verifiabl" barcode renderer.
 *
 * The QR matrix comes from the `qrcode` library. Data modules are rendered
 * as standard square modules, with rounded finder patterns in the three
 * large corner sections.
 */

export interface BarcodeSvgOptions {
  /** API environment for the public QR scan URL. Defaults to "production". */
  environment?: VerifiablEnvironment;
  /**
   * Advanced override for the public QR scan URL origin. Defaults to the
   * selected environment's scan URL origin. Must use https.
   */
  scanBaseUrl?: string;
  /** Total badge width in SVG user units / px (default: 480, the minimum). */
  width?: number;
}

/** QR error-correction level chosen by the damage-first degradation ladder. */
export type BarcodeErrorCorrectionLevel = "Q" | "M" | "L";

export interface BarcodeSvgResult {
  /** Complete standalone SVG document. */
  svg: string;
  width: number;
  height: number;
  /** The exact string encoded in the QR code. */
  content: string;
  /**
   * Error-correction level actually used. Normally "Q"; drops to "M" or "L"
   * only for unusually long PII so it still fits the fixed frame.
   */
  errorCorrectionLevel: BarcodeErrorCorrectionLevel;
  /** Rendered size of one QR module, in output pixels. */
  modulePx: number;
  /**
   * True when the ladder had to trade scan robustness to fit the payload
   * (error correction below "Q", or modules below the ideal size). False for
   * essentially all real records. Log this to observe the long tail at scale.
   */
  degraded: boolean;
}

const DEFAULT_NAVY = "#010A4F";
const DEFAULT_QR = "#000000";
const DEFAULT_TEXT = "#FFFFFF";
const FRAME_BORDER = "#ADADAD";
// White frame body so the QR quiet zone is always light, independent of the
// host document. The fill follows the rounded border path (rx=7), so the four
// corners outside that radius stay transparent.
const FRAME_BACKGROUND = "#FFFFFF";
const FRAME_VIEWBOX_WIDTH = 96;
const FRAME_VIEWBOX_HEIGHT = 151;
const FRAME_HEADER_HEIGHT = 47;
const FRAME_QR_BOX_X = 8;
const FRAME_QR_BOX_Y = 59;
const FRAME_QR_BOX_SIZE = 80;
// At this width, a realistic fully-populated PII record renders QR modules at
// or above IDEAL_MODULE_PX under "Q" error correction (the pristine tier).
const MIN_BADGE_WIDTH = 480;
const FINDER_SIZE = 7;
// Damage-first degradation ladder. The branded frame's outer size is fixed, so
// the only levers are error-correction level and module size inside the fixed
// QR box. We keep the highest correction level (best damage recovery: Q ~25%,
// M ~15%, L ~7%) whose modules still clear the floor, trading damage tolerance
// for resolution only when forced, and never varying the frame. Error
// correction is invisible to the scan service, which only reads the decoded URL.
const ERROR_CORRECTION_LADDER = ["Q", "M", "L"] as const;
// Pristine target: at or above this module size (px) with "Q" correction, the
// code is not considered degraded.
const IDEAL_MODULE_PX = 4;
// Absolute floor: a module smaller than this (px) is unreliable for real-world
// scans, so we hard-error rather than emit it. Evaluated at the badge's width.
const MIN_MODULE_PX = 3;
// QR spec quiet zone: at least this many light modules around the symbol.
const QUIET_ZONE_MODULES = 4;
// Smallest internal inset (in modules) padded inside the fixed QR box.
const MIN_QR_INSET_MODULES = 1;
// Light gutter (viewBox units) on the tightest side: from the QR box edge to
// the inner edge of the frame border (border path at x=1, ~1u half-stroke).
// The frame body inside this gutter is white, so it counts toward the quiet
// zone. The top/bottom gutters are larger, so this side is the binding one.
const FRAME_QR_GUTTER = FRAME_QR_BOX_X - 2;

/**
 * Internal inset (in modules) needed so the total light margin around the QR -
 * the fixed white gutter plus the inset - is at least QUIET_ZONE_MODULES. Dense
 * symbols (small modules) already clear it from the gutter alone and keep the
 * minimum inset; only small/sparse symbols, which have large modules and huge
 * scannability headroom, need a larger inset. So this never affects the
 * degradation thresholds, which bite for dense payloads.
 */
function quietZoneInsetModules(size: number): number {
  for (let inset = MIN_QR_INSET_MODULES; inset < QUIET_ZONE_MODULES; inset++) {
    const moduleSize = FRAME_QR_BOX_SIZE / (size + inset * 2);
    if (FRAME_QR_GUTTER / moduleSize + inset >= QUIET_ZONE_MODULES) {
      return inset;
    }
  }
  return QUIET_ZONE_MODULES;
}

function renderModules(
  matrixData: Uint8Array,
  size: number,
  moduleSize: number,
  color: string,
): string {
  const parts: string[] = [];

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isFinderModule(row, col, size)) continue;
      if (!matrixData[row * size + col]) continue;
      const x = col * moduleSize;
      const y = row * moduleSize;
      parts.push(
        `<rect x="${round2(x)}" y="${round2(y)}" width="${round2(moduleSize)}" ` +
          `height="${round2(moduleSize)}" fill="${color}"/>`,
      );
    }
  }

  return parts.join("");
}

function isFinderModule(row: number, col: number, size: number): boolean {
  const inTop = row < FINDER_SIZE;
  const inLeft = col < FINDER_SIZE;
  const inRight = col >= size - FINDER_SIZE;
  const inBottom = row >= size - FINDER_SIZE;
  return (inTop && inLeft) || (inTop && inRight) || (inBottom && inLeft);
}

function renderFinders(size: number, moduleSize: number, color: string): string {
  const lastFinderOrigin = (size - FINDER_SIZE) * moduleSize;
  return (
    renderFinder(0, 0, moduleSize, color) +
    renderFinder(lastFinderOrigin, 0, moduleSize, color) +
    renderFinder(0, lastFinderOrigin, moduleSize, color)
  );
}

function renderFinder(originX: number, originY: number, moduleSize: number, color: string): string {
  const outer = FINDER_SIZE * moduleSize;
  const innerOffset = moduleSize;
  const inner = outer - moduleSize * 2;
  const dotOffset = moduleSize * 2;
  const dot = moduleSize * 3;
  const ringPath = `${roundedRectPath(originX, originY, outer, outer, moduleSize * 1.4)} ${roundedRectPath(
    originX + innerOffset,
    originY + innerOffset,
    inner,
    inner,
    moduleSize,
  )}`;

  return (
    `<path d="${ringPath}" fill="${color}" fill-rule="evenodd"/>` +
    `<rect x="${round2(originX + dotOffset)}" y="${round2(originY + dotOffset)}" ` +
    `width="${round2(dot)}" height="${round2(dot)}" rx="${round2(moduleSize * 0.65)}" ` +
    `fill="${color}"/>`
  );
}

function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const left = round2(x);
  const top = round2(y);
  const right = round2(x + width);
  const bottom = round2(y + height);
  const r = round2(Math.min(radius, width / 2, height / 2));

  return (
    `M${round2(x + radius)} ${top}H${round2(x + width - radius)}` +
    `A${r} ${r} 0 0 1 ${right} ${round2(y + radius)}` +
    `V${round2(y + height - radius)}A${r} ${r} 0 0 1 ${round2(x + width - radius)} ${bottom}` +
    `H${round2(x + radius)}A${r} ${r} 0 0 1 ${left} ${round2(y + height - radius)}` +
    `V${round2(y + radius)}A${r} ${r} 0 0 1 ${round2(x + radius)} ${top}Z`
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Verifiabl wordmark as vector paths (official logo asset, 80x16 design
 * units). Fills are applied by the containing group. The source clipPath is intentionally dropped:
 * the paths stay in bounds and a fixed clipPath id would collide when
 * multiple badges are inlined in one document.
 */
const WORDMARK_VIEWBOX_WIDTH = 80; // 80x16 design units
const WORDMARK_PATHS =
  '<path d="M16.5197 10.5847C16.5197 7.50118 18.9056 5.16821 22.0591 5.16821C25.2125 5.16821 27.593 7.50118 27.593 10.6243C27.5969 10.9172 27.5697 11.2096 27.512 11.4968H19.3293C19.6731 12.8363 20.7451 13.7078 22.1598 13.7078C23.2307 13.7078 24.1198 13.221 24.5851 12.5517H27.432C26.6437 14.6001 24.6016 16.0001 22.0952 16.0001C18.9056 16.0001 16.5197 13.6671 16.5197 10.5847ZM19.3501 9.56931H24.7877C24.6413 8.9579 24.2907 8.41522 23.7943 8.03156C23.2978 7.64789 22.6855 7.44637 22.0591 7.46052C20.7243 7.46052 19.7093 8.29129 19.3501 9.56931Z"/>' +
  '<path d="M28.931 5.41093H31.5589V6.97357C32.3681 5.89774 33.4795 5.24829 34.834 5.24829H35.2172V7.96697H34.834C32.7316 7.96697 31.5589 9.08236 31.5589 10.8241V15.7538H28.931V5.41093Z"/>' +
  '<path d="M35.9453 2.30778C35.9453 1.86653 36.12 1.44335 36.4309 1.13134C36.7418 0.819329 37.1634 0.644043 37.6031 0.644043C38.0428 0.644043 38.4644 0.819329 38.7753 1.13134C39.0862 1.44335 39.2609 1.86653 39.2609 2.30778C39.2609 2.74903 39.0862 3.17221 38.7753 3.48422C38.4644 3.79623 38.0428 3.97151 37.6031 3.97151C37.1634 3.97151 36.7418 3.79623 36.4309 3.48422C36.12 3.17221 35.9453 2.74903 35.9453 2.30778ZM36.2891 5.41108H38.917V15.7572H36.2891V5.41108Z"/>' +
  '<path d="M41.684 7.82539H40.0668V5.40781H41.684V4.57923C41.684 2.27154 43.0385 1.02979 45.5646 1.02979H46.838V3.44737H45.8274C44.878 3.44737 44.3119 3.97484 44.3119 4.88693V5.4144H46.6968V7.83198H44.3119V15.7638H41.684V7.82539Z"/>' +
  '<path d="M47.8816 2.30775C47.8927 1.87405 48.0722 1.46185 48.3818 1.15904C48.6913 0.856236 49.1065 0.686768 49.5388 0.686768C49.9711 0.686768 50.3863 0.856236 50.6959 1.15904C51.0055 1.46185 51.1849 1.87405 51.196 2.30775C51.1849 2.74145 51.0055 3.15364 50.6959 3.45645C50.3863 3.75926 49.9711 3.92873 49.5388 3.92873C49.1065 3.92873 48.6913 3.75926 48.3818 3.45645C48.0722 3.15364 47.8927 2.74145 47.8816 2.30775Z"/>' +
  '<path d="M50.8521 5.41089H48.2242V15.757H50.8521V5.41089Z"/>' +
  '<path d="M52.3085 10.5845C52.3085 7.50102 54.471 5.16806 57.3453 5.16806C57.976 5.15786 58.6016 5.28287 59.1804 5.53472C59.7591 5.78657 60.2777 6.15946 60.7013 6.6285V5.41091H63.3292V15.7571H60.7013V14.5395C60.2777 15.0085 59.7591 15.3814 59.1804 15.6333C58.6016 15.8851 57.976 16.0101 57.3453 15.9999C54.471 15.9999 52.3085 13.667 52.3085 10.5845ZM60.697 10.5845C60.697 8.96146 59.4837 7.7274 57.8501 7.7274C56.2328 7.7274 55.0207 8.96476 55.0207 10.5845C55.0207 12.2043 56.2328 13.4417 57.8501 13.4417C59.4837 13.4439 60.697 12.2065 60.697 10.5845Z"/>' +
  '<path d="M65.0406 1.7583H67.6686V6.62863C68.0916 6.15942 68.6094 5.78615 69.1876 5.53374C69.7657 5.28133 70.3909 5.15559 71.0213 5.16489C73.8912 5.16489 76.0341 7.49786 76.0341 10.5814C76.0341 13.6649 73.8912 15.9968 71.0213 15.9968C70.3914 16.0069 69.7665 15.8822 69.1884 15.6309C68.6103 15.3797 68.0922 15.0076 67.6686 14.5396V15.7572H65.0406V1.7583ZM73.3273 10.5836C73.3273 8.9605 72.1349 7.72643 70.4979 7.72643C68.8807 7.72643 67.6675 8.96379 67.6675 10.5836C67.6675 12.2034 68.8807 13.4407 70.4979 13.4407C72.1327 13.444 73.3251 12.2067 73.3251 10.5847L73.3273 10.5836Z"/>' +
  '<path d="M77.3721 1.7583H80V15.7572H77.3721V1.7583Z"/>' +
  '<path d="M18.3559 0.423077L13.33 12.8132L12.7508 13.0681C12.2449 13.2879 11.6843 13.0154 11.4456 12.4264L10.0736 9.05165L13.249 1.22198C13.5545 0.472527 14.1808 0 14.8641 0H18.1435C18.3208 0 18.4347 0.228571 18.3559 0.423077Z"/>' +
  '<path d="M4.37003 10.023H0.46431C0.120492 10.023 -0.103975 9.58345 0.0493195 9.20762L2.04543 4.28564L4.37003 10.023Z"/>' +
  '<path d="M12.9522 13.7473L12.5744 14.6791C12.4553 14.9798 12.2611 15.2448 12.0105 15.4484C11.7665 15.6466 11.4627 15.7559 11.1488 15.7582H8.34131C7.7369 15.7582 7.18613 15.3407 6.91787 14.6802L5.03672 10.0231L4.76846 9.36374L2.37378 3.47363H6.03642C6.72077 3.47363 7.3449 3.94726 7.65039 4.69561L9.74505 9.86264L10.9167 12.7473C11.2868 13.6637 12.1649 14.0934 12.9522 13.7473Z"/>';

const SECURED_BY_PATH =
  '<path d="M20.964 14.682C20.964 15.018 21.0247 15.3027 21.146 15.536C21.2673 15.7693 21.426 15.9607 21.622 16.11C21.8273 16.25 22.0653 16.3573 22.336 16.432C22.6067 16.4973 22.8867 16.53 23.176 16.53C23.372 16.53 23.582 16.516 23.806 16.488C24.03 16.4507 24.24 16.3853 24.436 16.292C24.632 16.1987 24.7953 16.0727 24.926 15.914C25.0567 15.746 25.122 15.536 25.122 15.284C25.122 15.0133 25.0333 14.794 24.856 14.626C24.688 14.458 24.464 14.318 24.184 14.206C23.904 14.094 23.5867 13.996 23.232 13.912C22.8773 13.828 22.518 13.7347 22.154 13.632C21.7807 13.5387 21.4167 13.4267 21.062 13.296C20.7073 13.156 20.39 12.9787 20.11 12.764C19.83 12.5493 19.6013 12.2833 19.424 11.966C19.256 11.6393 19.172 11.2473 19.172 10.79C19.172 10.2767 19.2793 9.83333 19.494 9.46C19.718 9.07733 20.0073 8.76 20.362 8.508C20.7167 8.256 21.118 8.06933 21.566 7.948C22.014 7.82667 22.462 7.766 22.91 7.766C23.4327 7.766 23.932 7.82667 24.408 7.948C24.8933 8.06 25.3227 8.24667 25.696 8.508C26.0693 8.76933 26.3633 9.10533 26.578 9.516C26.802 9.91733 26.914 10.4073 26.914 10.986H24.786C24.7673 10.6873 24.702 10.44 24.59 10.244C24.4873 10.048 24.3473 9.894 24.17 9.782C23.9927 9.67 23.7873 9.59067 23.554 9.544C23.33 9.49733 23.0827 9.474 22.812 9.474C22.6347 9.474 22.4573 9.49267 22.28 9.53C22.1027 9.56733 21.9393 9.63267 21.79 9.726C21.65 9.81933 21.5333 9.936 21.44 10.076C21.3467 10.216 21.3 10.3933 21.3 10.608C21.3 10.804 21.3373 10.9627 21.412 11.084C21.4867 11.2053 21.6313 11.3173 21.846 11.42C22.07 11.5227 22.3733 11.6253 22.756 11.728C23.148 11.8307 23.6567 11.9613 24.282 12.12C24.4687 12.1573 24.7253 12.2273 25.052 12.33C25.388 12.4233 25.7193 12.5773 26.046 12.792C26.3727 13.0067 26.6527 13.296 26.886 13.66C27.1287 14.0147 27.25 14.472 27.25 15.032C27.25 15.4893 27.1613 15.914 26.984 16.306C26.8067 16.698 26.5407 17.0387 26.186 17.328C25.8407 17.608 25.4067 17.8273 24.884 17.986C24.3707 18.1447 23.7733 18.224 23.092 18.224C22.5413 18.224 22.0047 18.154 21.482 18.014C20.9687 17.8833 20.5113 17.6733 20.11 17.384C19.718 17.0947 19.4053 16.726 19.172 16.278C18.9387 15.83 18.8267 15.298 18.836 14.682H20.964ZM33.2198 13.604C33.1265 13.1 32.9585 12.7173 32.7158 12.456C32.4825 12.1947 32.1231 12.064 31.6378 12.064C31.3205 12.064 31.0545 12.12 30.8398 12.232C30.6345 12.3347 30.4665 12.4653 30.3358 12.624C30.2145 12.7827 30.1258 12.9507 30.0698 13.128C30.0231 13.3053 29.9951 13.464 29.9858 13.604H33.2198ZM29.9858 14.864C30.0138 15.508 30.1771 15.9747 30.4758 16.264C30.7745 16.5533 31.2038 16.698 31.7638 16.698C32.1651 16.698 32.5105 16.6 32.7998 16.404C33.0891 16.1987 33.2665 15.984 33.3318 15.76H35.0818C34.8018 16.628 34.3725 17.2487 33.7938 17.622C33.2151 17.9953 32.5151 18.182 31.6938 18.182C31.1245 18.182 30.6111 18.0933 30.1538 17.916C29.6965 17.7293 29.3091 17.468 28.9918 17.132C28.6745 16.796 28.4271 16.3947 28.2498 15.928C28.0818 15.4613 27.9978 14.948 27.9978 14.388C27.9978 13.8467 28.0865 13.3427 28.2638 12.876C28.4411 12.4093 28.6931 12.008 29.0198 11.672C29.3465 11.3267 29.7338 11.056 30.1818 10.86C30.6391 10.664 31.1431 10.566 31.6938 10.566C32.3098 10.566 32.8465 10.6873 33.3038 10.93C33.7611 11.1633 34.1345 11.4807 34.4238 11.882C34.7225 12.2833 34.9371 12.7407 35.0678 13.254C35.1985 13.7673 35.2451 14.304 35.2078 14.864H29.9858ZM41.3149 13.31C41.1842 12.4793 40.6942 12.064 39.8449 12.064C39.5275 12.064 39.2615 12.1387 39.0469 12.288C38.8322 12.428 38.6549 12.6147 38.5149 12.848C38.3842 13.072 38.2909 13.324 38.2349 13.604C38.1789 13.8747 38.1509 14.1453 38.1509 14.416C38.1509 14.6773 38.1789 14.9433 38.2349 15.214C38.2909 15.4847 38.3795 15.732 38.5009 15.956C38.6315 16.1707 38.8042 16.348 39.0189 16.488C39.2335 16.628 39.4949 16.698 39.8029 16.698C40.2789 16.698 40.6429 16.5673 40.8949 16.306C41.1562 16.0353 41.3195 15.676 41.3849 15.228H43.3029C43.1722 16.1893 42.7989 16.922 42.1829 17.426C41.5669 17.93 40.7782 18.182 39.8169 18.182C39.2755 18.182 38.7762 18.0933 38.3189 17.916C37.8709 17.7293 37.4882 17.4727 37.1709 17.146C36.8535 16.8193 36.6062 16.432 36.4289 15.984C36.2515 15.5267 36.1629 15.0273 36.1629 14.486C36.1629 13.926 36.2422 13.408 36.4009 12.932C36.5689 12.4467 36.8115 12.0313 37.1289 11.686C37.4462 11.3313 37.8335 11.056 38.2909 10.86C38.7482 10.664 39.2709 10.566 39.8589 10.566C40.2882 10.566 40.6989 10.622 41.0909 10.734C41.4922 10.846 41.8469 11.0187 42.1549 11.252C42.4722 11.476 42.7289 11.7607 42.9249 12.106C43.1209 12.442 43.2329 12.8433 43.2609 13.31H41.3149ZM51.2159 18H49.3259V16.992H49.2839C49.0319 17.412 48.7053 17.7153 48.3039 17.902C47.9026 18.0887 47.4919 18.182 47.0719 18.182C46.5399 18.182 46.1013 18.112 45.7559 17.972C45.4199 17.832 45.1539 17.636 44.9579 17.384C44.7619 17.1227 44.6219 16.81 44.5379 16.446C44.4633 16.0727 44.4259 15.662 44.4259 15.214V10.762H46.4139V14.85C46.4139 15.4473 46.5073 15.8953 46.6939 16.194C46.8806 16.4833 47.2119 16.628 47.6879 16.628C48.2293 16.628 48.6213 16.4693 48.8639 16.152C49.1066 15.8253 49.2279 15.2933 49.2279 14.556V10.762H51.2159V18ZM52.7248 10.762H54.6148V12.106H54.6428C54.7361 11.882 54.8621 11.6767 55.0208 11.49C55.1794 11.294 55.3614 11.1307 55.5667 11C55.7721 10.86 55.9914 10.7527 56.2248 10.678C56.4581 10.6033 56.7008 10.566 56.9528 10.566C57.0834 10.566 57.2281 10.5893 57.3868 10.636V12.484C57.2934 12.4653 57.1814 12.4513 57.0508 12.442C56.9201 12.4233 56.7941 12.414 56.6728 12.414C56.3088 12.414 56.0008 12.4747 55.7488 12.596C55.4968 12.7173 55.2914 12.8853 55.1328 13.1C54.9834 13.3053 54.8761 13.548 54.8108 13.828C54.7454 14.108 54.7128 14.4113 54.7128 14.738V18H52.7248V10.762ZM62.7921 13.604C62.6987 13.1 62.5307 12.7173 62.2881 12.456C62.0547 12.1947 61.6954 12.064 61.2101 12.064C60.8927 12.064 60.6267 12.12 60.4121 12.232C60.2067 12.3347 60.0387 12.4653 59.9081 12.624C59.7867 12.7827 59.6981 12.9507 59.6421 13.128C59.5954 13.3053 59.5674 13.464 59.5581 13.604H62.7921ZM59.5581 14.864C59.5861 15.508 59.7494 15.9747 60.0481 16.264C60.3467 16.5533 60.7761 16.698 61.3361 16.698C61.7374 16.698 62.0827 16.6 62.3721 16.404C62.6614 16.1987 62.8387 15.984 62.9041 15.76H64.6541C64.3741 16.628 63.9447 17.2487 63.3661 17.622C62.7874 17.9953 62.0874 18.182 61.2661 18.182C60.6967 18.182 60.1834 18.0933 59.7261 17.916C59.2687 17.7293 58.8814 17.468 58.5641 17.132C58.2467 16.796 57.9994 16.3947 57.8221 15.928C57.6541 15.4613 57.5701 14.948 57.5701 14.388C57.5701 13.8467 57.6587 13.3427 57.8361 12.876C58.0134 12.4093 58.2654 12.008 58.5921 11.672C58.9187 11.3267 59.3061 11.056 59.7541 10.86C60.2114 10.664 60.7154 10.566 61.2661 10.566C61.8821 10.566 62.4187 10.6873 62.8761 10.93C63.3334 11.1633 63.7067 11.4807 63.9961 11.882C64.2947 12.2833 64.5094 12.7407 64.6401 13.254C64.7707 13.7673 64.8174 14.304 64.7801 14.864H59.5581ZM71.0971 14.36C71.0971 14.0613 71.0691 13.7767 71.0131 13.506C70.9571 13.226 70.8591 12.9833 70.7191 12.778C70.5885 12.5633 70.4158 12.3907 70.2011 12.26C69.9865 12.1293 69.7158 12.064 69.3891 12.064C69.0625 12.064 68.7871 12.1293 68.5631 12.26C68.3391 12.3907 68.1571 12.5633 68.0171 12.778C67.8865 12.9927 67.7885 13.24 67.7231 13.52C67.6671 13.7907 67.6391 14.0753 67.6391 14.374C67.6391 14.654 67.6718 14.934 67.7371 15.214C67.8025 15.494 67.9051 15.746 68.0451 15.97C68.1945 16.1847 68.3765 16.362 68.5911 16.502C68.8151 16.6327 69.0811 16.698 69.3891 16.698C69.7158 16.698 69.9865 16.6327 70.2011 16.502C70.4251 16.3713 70.6025 16.1987 70.7331 15.984C70.8638 15.76 70.9571 15.508 71.0131 15.228C71.0691 14.948 71.0971 14.6587 71.0971 14.36ZM71.1251 17.076H71.0971C70.8638 17.468 70.5558 17.7527 70.1731 17.93C69.7998 18.098 69.3751 18.182 68.8991 18.182C68.3578 18.182 67.8818 18.0793 67.4711 17.874C67.0605 17.6593 66.7198 17.3747 66.4491 17.02C66.1878 16.656 65.9871 16.2407 65.8471 15.774C65.7165 15.3073 65.6511 14.822 65.6511 14.318C65.6511 13.8327 65.7165 13.366 65.8471 12.918C65.9871 12.4607 66.1878 12.0593 66.4491 11.714C66.7198 11.3687 67.0558 11.0933 67.4571 10.888C67.8585 10.6733 68.3251 10.566 68.8571 10.566C69.2865 10.566 69.6925 10.6593 70.0751 10.846C70.4671 11.0233 70.7751 11.2893 70.9991 11.644H71.0271V8.004H73.0151V18H71.1251V17.076ZM83.7202 14.388C83.7202 14.08 83.6875 13.786 83.6222 13.506C83.5569 13.226 83.4542 12.9787 83.3142 12.764C83.1742 12.5493 82.9969 12.3813 82.7822 12.26C82.5769 12.1293 82.3249 12.064 82.0262 12.064C81.7369 12.064 81.4849 12.1293 81.2702 12.26C81.0555 12.3813 80.8782 12.5493 80.7382 12.764C80.5982 12.9787 80.4955 13.226 80.4302 13.506C80.3649 13.786 80.3322 14.08 80.3322 14.388C80.3322 14.6867 80.3649 14.976 80.4302 15.256C80.4955 15.536 80.5982 15.7833 80.7382 15.998C80.8782 16.2127 81.0555 16.3853 81.2702 16.516C81.4849 16.6373 81.7369 16.698 82.0262 16.698C82.3249 16.698 82.5769 16.6373 82.7822 16.516C82.9969 16.3853 83.1742 16.2127 83.3142 15.998C83.4542 15.7833 83.5569 15.536 83.6222 15.256C83.6875 14.976 83.7202 14.6867 83.7202 14.388ZM78.4142 8.004H80.4022V11.644H80.4302C80.6729 11.2707 80.9995 11 81.4102 10.832C81.8302 10.6547 82.2642 10.566 82.7122 10.566C83.0762 10.566 83.4355 10.6407 83.7902 10.79C84.1449 10.9393 84.4622 11.168 84.7422 11.476C85.0315 11.784 85.2649 12.1807 85.4422 12.666C85.6195 13.142 85.7082 13.7113 85.7082 14.374C85.7082 15.0367 85.6195 15.6107 85.4422 16.096C85.2649 16.572 85.0315 16.964 84.7422 17.272C84.4622 17.58 84.1449 17.8087 83.7902 17.958C83.4355 18.1073 83.0762 18.182 82.7122 18.182C82.1802 18.182 81.7042 18.098 81.2842 17.93C80.8642 17.762 80.5469 17.4773 80.3322 17.076H80.3042V18H78.4142V8.004ZM90.5428 18.896C90.3281 19.484 90.0295 19.904 89.6468 20.156C89.2641 20.408 88.7321 20.534 88.0508 20.534C87.8455 20.534 87.6401 20.5247 87.4348 20.506C87.2388 20.4967 87.0381 20.4827 86.8328 20.464V18.826C87.0195 18.8447 87.2108 18.8633 87.4068 18.882C87.6028 18.9007 87.7988 18.9053 87.9948 18.896C88.2561 18.868 88.4475 18.7653 88.5688 18.588C88.6995 18.4107 88.7648 18.2147 88.7648 18C88.7648 17.8413 88.7368 17.692 88.6808 17.552L86.1468 10.762H88.2608L89.8988 15.718H89.9268L91.5088 10.762H93.5668L90.5428 18.896Z" fill="{color}"/>';

function renderWordmark(x: number, top: number, renderWidth: number, color: string): string {
  const k = renderWidth / WORDMARK_VIEWBOX_WIDTH;
  return (
    `<g transform="translate(${round2(x)} ${round2(top)}) scale(${round2(k)})" ` +
    `fill="${color}">${WORDMARK_PATHS}</g>`
  );
}

function renderDefaultHeader(textColor: string): string {
  return (
    `<g transform="translate(-8 0)">${SECURED_BY_PATH.replace("{color}", textColor)}</g>` +
    renderWordmark(8, 23, 80, textColor)
  );
}

/**
 * Render the branded Verifiabl barcode as SVG.
 *
 * Takes the Verifiabl reference from `client.registerNonPii` and the encrypted PII
 * ciphertext from `encryptPii`, then returns a standalone SVG suitable for
 * embedding in a payslip PDF.
 */
export function createBarcodeSvg(
  parts: BarcodeParts,
  options: BarcodeSvgOptions = {},
): BarcodeSvgResult {
  const { width = MIN_BADGE_WIDTH } = options;
  const badgeWidth = validateBadgeWidth(width, "width");

  const scanOptions: ScanUrlOptions = {};
  if (options.environment !== undefined) {
    scanOptions.environment = options.environment;
  }
  if (options.scanBaseUrl !== undefined) {
    scanOptions.scanBaseUrl = options.scanBaseUrl;
  }
  const content = buildScanUrl(parts, scanOptions);

  const { qr, errorCorrectionLevel, size, moduleSize, modulePx, insetModules } = selectQrRendering(
    content,
    badgeWidth,
  );
  const matrixData = qr.modules.data;
  const degraded = errorCorrectionLevel !== "Q" || modulePx < IDEAL_MODULE_PX;

  const height = round2((badgeWidth * FRAME_VIEWBOX_HEIGHT) / FRAME_VIEWBOX_WIDTH);
  const qrPadding = insetModules * moduleSize;

  const headerBackground = `<path d="M0 8C0 3.58172 3.58172 0 8 0H88C92.4183 0 96 3.58172 96 8V${FRAME_HEADER_HEIGHT}H0V8Z" fill="${DEFAULT_NAVY}"/>`;
  const header = headerBackground + renderDefaultHeader(DEFAULT_TEXT);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round2(badgeWidth)}" height="${round2(height)}" ` +
    `viewBox="0 0 ${FRAME_VIEWBOX_WIDTH} ${FRAME_VIEWBOX_HEIGHT}" role="img" ` +
    `aria-label="Secured by Verifiabl verification barcode">` +
    `<rect x="1" y="1" width="94" height="149" rx="7" fill="${FRAME_BACKGROUND}"/>` +
    `<rect x="1" y="1" width="94" height="149" rx="7" stroke="${FRAME_BORDER}" stroke-width="2" fill="none"/>` +
    header +
    `<g transform="translate(${round2(FRAME_QR_BOX_X + qrPadding)} ${round2(FRAME_QR_BOX_Y + qrPadding)})">` +
    `<g shape-rendering="crispEdges">` +
    renderModules(matrixData, size, moduleSize, DEFAULT_QR) +
    `</g>` +
    renderFinders(size, moduleSize, DEFAULT_QR) +
    `</g></svg>`;

  return {
    svg,
    width: badgeWidth,
    height: round2(height),
    content,
    errorCorrectionLevel,
    modulePx: round2(modulePx),
    degraded,
  };
}

interface SelectedQrRendering {
  qr: ReturnType<typeof QRCode.create>;
  errorCorrectionLevel: BarcodeErrorCorrectionLevel;
  size: number;
  moduleSize: number;
  modulePx: number;
  insetModules: number;
}

/**
 * Walk the damage-first ladder and pick the rendering that fits the fixed
 * frame: the highest error-correction level whose modules still clear
 * MIN_MODULE_PX at this width. The frame's outer width and height never change.
 * Hard-errors if even the lowest level cannot fit, so an over-long payload
 * fails loudly at issuance instead of producing an unscannable code.
 */
function selectQrRendering(content: string, badgeWidth: number): SelectedQrRendering {
  const scale = badgeWidth / FRAME_VIEWBOX_WIDTH;
  let densestSize: number | null = null;
  for (const errorCorrectionLevel of ERROR_CORRECTION_LADDER) {
    let qr: ReturnType<typeof QRCode.create>;
    try {
      qr = QRCode.create(content, { errorCorrectionLevel });
    } catch (error) {
      // The qrcode library throws "...too big to be stored..." when the content
      // exceeds capacity at this level; a lower level holds more, so try it.
      // Surface any other (unexpected) failure instead of masking it.
      if (error instanceof Error && error.message.includes("too big")) {
        continue;
      }
      throw error;
    }
    const size = qr.modules.size;
    const insetModules = quietZoneInsetModules(size);
    const moduleSize = FRAME_QR_BOX_SIZE / (size + insetModules * 2);
    const modulePx = moduleSize * scale;
    if (modulePx >= MIN_MODULE_PX) {
      return { qr, errorCorrectionLevel, size, moduleSize, modulePx, insetModules };
    }
    densestSize = size;
  }
  if (densestSize === null) {
    throw new Error(
      `The QR content (scan URL) is too large to encode in a QR code at any error-correction ` +
        `level (${content.length} characters). Shorten the PII fields and try again.`,
    );
  }
  throw new Error(
    `The PII is too long to render a scannable barcode in the branded frame at width ${badgeWidth}, ` +
      `even at the lowest error correction. Shorten the PII fields and try again.`,
  );
}

function validateBadgeWidth(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  if (value < MIN_BADGE_WIDTH) {
    throw new Error(`${name} must be at least ${MIN_BADGE_WIDTH}`);
  }
  return value;
}

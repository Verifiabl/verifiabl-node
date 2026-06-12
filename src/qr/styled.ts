import QRCode from "qrcode";
import {
  type BarcodeParts,
  buildBarcodePayload,
  buildScanUrl,
  type ScanUrlOptions,
  type VerifiablEnvironment,
} from "../payload.js";

/**
 * Branded "Secured by Verifiabl" QR badge renderer.
 *
 * The QR matrix comes from the `qrcode` library; all styling (navy card,
 * header wordmark, rounded modules, styled finder patterns) is rendered
 * here as dependency-free SVG, so output is deterministic and there are
 * no native or browser dependencies.
 */

export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface BarcodeSvgColors {
  /** Card background and module colour (default: Verifiabl navy). */
  navy?: string;
  /** QR panel background (default: white). */
  panel?: string;
  /** Header text colour (default: white). */
  text?: string;
}

export interface BarcodeSvgOptions {
  /** API environment for the public QR scan URL. Defaults to "production". */
  environment?: VerifiablEnvironment;
  /**
   * Advanced override for the public QR scan URL origin. Defaults to the
   * selected environment's scan URL origin. Must use https.
   */
  scanBaseUrl?: string;
  /**
   * What the QR encodes: the public scan URL (default, phone-scan
   * friendly) or the bare `1|lt|ct` payload (smaller QR code).
   */
  encode?: "url" | "payload";
  /** QR error correction level (default: "M"). */
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  /** Total badge width in SVG user units / px (default: 360). */
  width?: number;
  /** Render the branded card frame and header (default: true). When false, returns the bare styled QR. */
  frame?: boolean;
  /** Small line above the wordmark (default: "Secured by"). */
  headerText?: string;
  /**
   * Replace the built-in header (text + wordmark) with your own raw SVG
   * fragment, rendered into the header band. Trusted input: do not pass
   * user-controlled content.
   */
  logoSvg?: string;
  colors?: BarcodeSvgColors;
}

export interface BarcodeSvgResult {
  /** Complete standalone SVG document. */
  svg: string;
  width: number;
  height: number;
  /** The exact string encoded in the QR code. */
  content: string;
}

const DEFAULT_NAVY = "#0B1547";
const FINDER_SIZE = 7;
// ISO/IEC 18004 requires a quiet zone of at least 4 modules on every side
// for reliable scanning after print + recapture.
const QUIET_ZONE_MODULES = 4;
const SVG_COLOR_RE =
  /^(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1})?|#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?|[a-zA-Z][a-zA-Z0-9-]*|(?:rgb|rgba|hsl|hsla)\([0-9%.,\s/+-]+\))$/;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXmlAttr(value: string): string {
  return escapeXml(value).replace(/'/g, "&apos;");
}

function validateSvgColor(value: string, name: string): string {
  const color = value.trim();
  if (!SVG_COLOR_RE.test(color)) {
    throw new Error(`${name} must be a valid SVG color`);
  }
  return escapeXmlAttr(color);
}

function isFinderModule(row: number, col: number, size: number): boolean {
  const inTopLeft = row < FINDER_SIZE && col < FINDER_SIZE;
  const inTopRight = row < FINDER_SIZE && col >= size - FINDER_SIZE;
  const inBottomLeft = row >= size - FINDER_SIZE && col < FINDER_SIZE;
  return inTopLeft || inTopRight || inBottomLeft;
}

/** Rounded outer ring + rounded inner square, in module units. */
function renderFinder(originX: number, originY: number, moduleSize: number, color: string): string {
  const outer = FINDER_SIZE * moduleSize;
  const inner = 3 * moduleSize;
  const innerOffset = 2 * moduleSize;
  const ring =
    `<rect x="${originX + moduleSize / 2}" y="${originY + moduleSize / 2}" ` +
    `width="${outer - moduleSize}" height="${outer - moduleSize}" ` +
    `rx="${moduleSize * 1.6}" fill="none" stroke="${color}" stroke-width="${moduleSize}"/>`;
  const dot =
    `<rect x="${originX + innerOffset}" y="${originY + innerOffset}" ` +
    `width="${inner}" height="${inner}" rx="${moduleSize * 0.9}" fill="${color}"/>`;
  return ring + dot;
}

function renderModules(
  matrixData: Uint8Array,
  size: number,
  moduleSize: number,
  color: string,
): string {
  const parts: string[] = [];

  parts.push(renderFinder(0, 0, moduleSize, color));
  parts.push(renderFinder((size - FINDER_SIZE) * moduleSize, 0, moduleSize, color));
  parts.push(renderFinder(0, (size - FINDER_SIZE) * moduleSize, moduleSize, color));

  // 0.98 keeps the rounded-dot look but leaves enough ink coverage per
  // module to decode reliably; at 0.94 decoders fail at some raster scales.
  const dotSize = moduleSize * 0.98;
  const dotRadius = moduleSize * 0.3;
  const inset = (moduleSize - dotSize) / 2;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isFinderModule(row, col, size)) continue;
      if (!matrixData[row * size + col]) continue;
      const x = col * moduleSize + inset;
      const y = row * moduleSize + inset;
      parts.push(
        `<rect x="${round2(x)}" y="${round2(y)}" width="${round2(dotSize)}" ` +
          `height="${round2(dotSize)}" rx="${round2(dotRadius)}" fill="${color}"/>`,
      );
    }
  }

  return parts.join("");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Verifiabl wordmark as vector paths (official logo asset, 80x16 design
 * units). Fills are applied by the containing group so the `colors.text`
 * option drives the colour. The source clipPath is intentionally dropped:
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

/** Render the official wordmark centred at `centerX`, top edge at `top`. */
function renderWordmark(centerX: number, top: number, color: string, scale: number): string {
  const renderWidth = 176 * scale;
  const k = renderWidth / WORDMARK_VIEWBOX_WIDTH;
  const x = centerX - renderWidth / 2;
  return (
    `<g transform="translate(${round2(x)} ${round2(top)}) scale(${round2(k)})" ` +
    `fill="${color}">${WORDMARK_PATHS}</g>`
  );
}

/**
 * Render the branded Verifiabl QR badge as SVG.
 *
 * Takes the linking token from `client.registerNonPii` and the encrypted PII
 * ciphertext from `encryptPii`, then returns a standalone SVG suitable for
 * embedding in a payslip PDF.
 */
export function createBarcodeSvg(
  parts: BarcodeParts,
  options: BarcodeSvgOptions = {},
): BarcodeSvgResult {
  const {
    encode: encodeOption = "url",
    errorCorrectionLevel: errorCorrectionLevelOption = "M",
    width = 360,
    frame = true,
    headerText = "Secured by",
    logoSvg,
    colors = {},
  } = options;

  const encode = validateEncode(encodeOption);
  const errorCorrectionLevel = validateErrorCorrectionLevel(errorCorrectionLevelOption);
  const navy = validateSvgColor(colors.navy ?? DEFAULT_NAVY, "colors.navy");
  const panel = validateSvgColor(colors.panel ?? "#FFFFFF", "colors.panel");
  const textColor = validateSvgColor(colors.text ?? "#FFFFFF", "colors.text");
  const badgeWidth = validatePositiveNumber(width, "width");

  const scanOptions: ScanUrlOptions = {};
  if (options.environment !== undefined) {
    scanOptions.environment = options.environment;
  }
  if (options.scanBaseUrl !== undefined) {
    scanOptions.scanBaseUrl = options.scanBaseUrl;
  }

  const content = encode === "url" ? buildScanUrl(parts, scanOptions) : buildBarcodePayload(parts);

  const qr = QRCode.create(content, { errorCorrectionLevel });
  const size = qr.modules.size;
  const matrixData = qr.modules.data;

  if (!frame) {
    const moduleSize = badgeWidth / (size + QUIET_ZONE_MODULES * 2);
    const quiet = QUIET_ZONE_MODULES * moduleSize;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeWidth}" ` +
      `viewBox="0 0 ${badgeWidth} ${badgeWidth}" role="img" aria-label="Verifiabl payslip QR code">` +
      `<rect width="${badgeWidth}" height="${badgeWidth}" fill="${panel}"/>` +
      `<g transform="translate(${round2(quiet)} ${round2(quiet)})">` +
      renderModules(matrixData, size, moduleSize, navy) +
      `</g></svg>`;
    return { svg, width: badgeWidth, height: badgeWidth, content };
  }

  // Card geometry, scaled from a 360-wide reference design.
  const scale = badgeWidth / 360;
  const cardRadius = 20 * scale;
  const headerHeight = 92 * scale;
  const panelMargin = 10 * scale;
  const panelRadius = 14 * scale;

  const panelSize = badgeWidth - panelMargin * 2;
  // Size modules so the white panel itself provides the 4-module quiet
  // zone around the symbol.
  const moduleSize = panelSize / (size + QUIET_ZONE_MODULES * 2);
  const qrPadding = QUIET_ZONE_MODULES * moduleSize;
  const height = headerHeight + panelSize + panelMargin;

  const header =
    logoSvg ??
    `<text x="${round2(badgeWidth / 2)}" y="${round2(34 * scale)}" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="${round2(15 * scale)}" ` +
      `font-weight="500" fill="${textColor}">${escapeXml(headerText)}</text>` +
      renderWordmark(badgeWidth / 2, 44 * scale, textColor, scale);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round2(badgeWidth)}" height="${round2(height)}" ` +
    `viewBox="0 0 ${round2(badgeWidth)} ${round2(height)}" role="img" ` +
    `aria-label="Secured by Verifiabl payslip QR code">` +
    `<rect width="${round2(badgeWidth)}" height="${round2(height)}" rx="${round2(cardRadius)}" fill="${navy}"/>` +
    `<rect x="${round2(panelMargin)}" y="${round2(headerHeight)}" width="${round2(panelSize)}" ` +
    `height="${round2(panelSize)}" rx="${round2(panelRadius)}" fill="${panel}"/>` +
    header +
    `<g transform="translate(${round2(panelMargin + qrPadding)} ${round2(headerHeight + qrPadding)})">` +
    renderModules(matrixData, size, moduleSize, navy) +
    `</g></svg>`;

  return { svg, width: badgeWidth, height: round2(height), content };
}

function validatePositiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function validateEncode(value: BarcodeSvgOptions["encode"]): "url" | "payload" {
  if (value === "url" || value === "payload") {
    return value;
  }
  throw new Error("encode must be 'url' or 'payload'");
}

function validateErrorCorrectionLevel(
  value: BarcodeSvgOptions["errorCorrectionLevel"],
): QrErrorCorrectionLevel {
  if (value === "L" || value === "M" || value === "Q" || value === "H") {
    return value;
  }
  throw new Error("errorCorrectionLevel must be 'L', 'M', 'Q', or 'H'");
}

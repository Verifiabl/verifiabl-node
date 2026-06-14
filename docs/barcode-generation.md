# Barcode generation: design and trade-offs

How the branded "Secured by Verifiabl" barcode is generated, the guarantees it
makes, the decisions behind it, and where the approach stops scaling.

Source: [`src/qr/styled.ts`](../src/qr/styled.ts) (SVG) and
[`src/qr/png.ts`](../src/qr/png.ts) (PNG). Payload format:
[`src/payload.ts`](../src/payload.ts). PII wire format:
[`src/pii.ts`](../src/pii.ts).

---

## 1. Goal

Issue a visually identical, machine-readable barcode on potentially millions of
payslips. Two properties matter above all:

1. **Consistency** - every badge looks the same across every issuer, document
   pipeline, OS, and render target. The brand mark must not drift.
2. **Scannability** - the QR must decode reliably in the field, including on
   printed and photographed payslips, without depending on the host document.

These two goals are in tension with a third (carrying more PII), and most of the
design is about resolving that tension predictably.

---

## 2. Pipeline

```
PiiFields
  → formatPii()        compact pipe-delimited plaintext: "P1|name|position|...|account_name"
  → encryptPii()       AES-256-GCM, base64url ciphertext (PII never leaves the badge in clear)
  → buildBarcodePayload()   "1|<linkingToken>|<ciphertext>"
  → buildScanUrl()     "https://verify.verifiabl.io/v/<urlencoded payload>"
  → QR encode          qrcode lib, error-correction level chosen by the ladder (§5)
  → branded SVG        fixed frame + QR drawn into a fixed box
  → (optional) PNG     resvg rasterises the SVG
```

The string encoded in the QR is a **scan URL**, not the raw payload, so a phone
camera preview shows a Verifiabl URL rather than opaque ciphertext, and the
scan resolves through Verifiabl's verify service.

The encrypted PII travels **inside the barcode**, not in Verifiabl's database.
The API only stores the non-PII linking token. This is a deliberate
privacy-preserving choice and it constrains the design: the ciphertext size is
load-bearing on the QR (see §10).

---

## 3. The branded frame

Fixed `viewBox="0 0 96 151"`. Everything is positioned in these units and the
whole frame scales uniformly to the requested pixel width.

| Element | Spec |
|---|---|
| Border | `rect x=1 y=1 w=94 h=149 rx=7`, stroke `#ADADAD`, 2px |
| Body | white `#FFFFFF`, same rounded-rect path (corners transparent) |
| Header | navy `#010A4F`, rounded top corners, height 47 |
| Wordmark + "Secured by" | embedded **vector paths**, not text |
| QR box | fixed `x=8 y=59 w=80 h=80` |
| QR modules | black `#000000`, square, `shape-rendering="crispEdges"` |
| Finder patterns | rounded outer ring + rounded centre dot |

Two properties make the frame consistent by construction:

- **No fonts.** The wordmark and "Secured by" are vector paths, so there is zero
  dependence on system fonts or font rendering. The brand mark is byte-identical
  everywhere.
- **Deterministic output.** Same input → byte-identical SVG. No randomness,
  timestamps, or locale. Aspect ratio is locked (`height = width * 151 / 96`).

The **outer dimensions never change** to accommodate the payload. Only the QR
inside the fixed box flexes (§5).

---

## 4. Why the QR sits on a white body

QR codes need a light quiet zone. An earlier revision left the frame body
transparent and documented "place on a white area," which pushed quiet-zone
reliability onto the host document - exactly the kind of thing that warps out of
our control across millions of payslip templates.

The body is now an explicit white rounded-rect painted behind the QR, so the
quiet zone is guaranteed regardless of what the document places behind the
badge. Only the four rounded corners outside the `rx=7` radius stay transparent.
This is verified by a test that decodes the badge composited over a hostile
full-bleed background.

The quiet zone is also kept at the QR spec's >= 4 light modules. The fixed white
gutter between the QR box and the border already covers this for dense symbols;
small/sparse symbols have large modules, so `quietZoneInsetModules()` pads them
with a larger internal inset until the total light margin reaches 4 modules.
Because this only fires for sparse symbols (which sit far above the scannability
floor), it never affects the degradation thresholds in §5.

---

## 5. Scannability: the damage-first degradation ladder

QR module size shrinks as the payload grows (more data → higher QR version →
more modules → smaller modules in the fixed 80-unit box). Because the frame size
is fixed, the only levers that don't change the frame are:

1. **Error-correction level** (`Q → M → L`): redundancy / damage tolerance.
   Invisible to the scan service - the decoded URL is identical at every level.
   Lower EC also needs fewer modules for the same data, so it makes modules
   *bigger*.
2. **Module size** inside the fixed QR box.

`selectQrRendering()` walks a **damage-first** ladder: keep the highest EC whose
modules still clear the readable floor, preferring damage tolerance over
resolution, and hard-error if even the lowest level can't fit.

```
for ec in [Q, M, L]:                 # highest correction first
    qr = encode(content, ec)         # skip if it exceeds capacity at this ec
    if modulePx(qr, width) >= MIN_MODULE_PX:
        return qr at ec              # first (highest ec) that clears the floor
throw                                # too dense even at L, or beyond QR capacity
```

Constants ([`src/qr/styled.ts`](../src/qr/styled.ts)):

| Constant | Value | Meaning |
|---|---|---|
| `MIN_BADGE_WIDTH` | 480 | min/default width; realistic full PII stays pristine here |
| `IDEAL_MODULE_PX` | 4 | pristine = "Q" and modules ≥ 4px |
| `MIN_MODULE_PX` | 3 | absolute floor; hard-error below this even at L |
| `ERROR_CORRECTION_LADDER` | `Q,M,L` | damage-first order |

Approximate PII capacity at the 480px minimum (total characters across all 7
fields):

| EC | modules ≥ 4px (pristine) | modules ≥ 3px (floor) |
|---|---|---|
| Q | ~314 | ~602 |
| M | ~452 | ~844 |
| L | ~596 | ~1098 |

Real payslip records run ~120-230 characters, so they stay in the **Q / ≥4px
pristine** tier and never degrade. Degradation is a rare-tail safety net, not
the default path.

### Observability

The result reports what the ladder did, so the long tail is visible at scale
rather than silently rotting:

- `errorCorrectionLevel`: `"Q" | "M" | "L"` actually used.
- `modulePx`: rendered module size in output pixels.
- `degraded`: `true` when EC dropped below Q or modules fell below the ideal.
  `false` for essentially all real records. Log it to catch integrations
  pushing oversized PII.

---

## 6. Decisions and alternatives considered

| Decision | Alternative(s) | Why |
|---|---|---|
| **Error correction starts at Q** (~25%) | M (~15%, default) | Payslips get printed, faxed, and photographed; Q survives damage. EC is free at the scan service. |
| **White frame body** | Transparent quiet zone, "place on white" | Removes dependence on the host document; quiet zone is guaranteed. |
| **Fixed frame, degrade the QR** | Auto-widen the badge to fit | Brand consistency: outer dimensions must not vary. Widening would change the badge's footprint on every long record. |
| **Damage-first ladder** | Resolution-first (keep modules ≥4px, drop EC first); balanced | Print/photo robustness was the priority that motivated Q; preserve damage tolerance, spend resolution down to the floor. |
| **Hard-error past the floor** | Silently emit a sub-floor (unscannable) code; auto-widen | Fail loud at issuance and gather real feedback before adding complexity. An unscannable badge discovered in the field is worse than a build-time error. |
| **`MIN_BADGE_WIDTH = 480`** | 420 | Under Q, a realistic *long* record renders ~3.85px at 420 - below the 4px floor. 480 keeps realistic long PII pristine without fudging the floor. |
| **PII encrypted inside the QR** | Token-only QR, PII resolved server-side | Privacy model: Verifiabl never stores PII. Token-only would shrink the QR dramatically but break that guarantee. |
| **Scan URL in the QR** | Raw payload bytes | A phone preview shows a Verifiabl URL, not opaque ciphertext; routes scanners to the verify service. Costs ~59 bytes of fixed overhead. |
| **Vector wordmark** | `<text>` element | No font dependency → identical rendering everywhere. |
| **Rounded finder patterns** | Standard square finders | Matches the Figma brand. Slight deviation from the canonical 1:1:3:1:1 finder; tolerated by decoders we tested (see §10). |

### Capacity levers we measured but did **not** take

- **Shorten the scan URL** (shorter domain, drop `%7C` encoding): buys only
  ~2-8% more PII capacity. Not worth a URL/format change.
- **Compress plaintext before encryption:** GCM ciphertext is incompressible;
  you'd compress the ~200-char plaintext for marginal, complexity-heavy gains.
- **Reduce scannability to fit more:** rejected outright - it spends the exact
  reliability the product depends on.

---

## 7. Testing approach

- **End-to-end decode:** rasterise the emitted SVG and decode with an
  independent reader (`jsQR`), asserting the decoded URL round-trips.
- **Diverse PII:** accented, hyphenated, transliterated, and CJK names/roles to
  cover the variety issuers actually emit.
- **Ladder coverage:** ordered EC degradation (Q→M→L), degraded-but-decodable
  codes, hard-error on over-long and over-capacity PII.
- **Hostile background:** decode composited over dark/grey full-bleed backgrounds
  to prove the white body protects the quiet zone.
- **Geometry/transparency:** pixel sampling confirms white body, transparent
  corners, navy header.

**Methodology note:** decoding at exactly 1:1 (a 480-unit badge rasterised to
480px) is non-monotonic due to pixel-grid aliasing - it is a sampling artifact,
not real scannability. Degraded codes are validated at a supersampled raster
(2×), which represents any normal-DPI render or camera capture.

---

## 8. Where it does not scale / known limitations

1. **QR capacity ceiling.** A QR maxes out around v40. The PII schema allows
   256 chars/field × 7 ≈ 1,800 chars, which a single deeply-pathological record
   can push beyond what fits the fixed 480px frame even at level L - those
   hard-error. This is not reachable by realistic payroll data, only by stuffing
   every field near its cap.

2. **Schema vs QR capacity mismatch.** `ciphertextSchema` permits up to 10,000
   characters, far beyond any QR's capacity. The renderer is the real gate (it
   hard-errors with a clear message), but the two limits are not reconciled.
   A future tightening could cap PII at the schema layer.

3. **Density depends on render DPI we don't control.** The 3-4px module floor is
   evaluated at the badge's nominal width. Issuers embed the vector SVG into PDFs
   and print at sizes/DPIs we can't see. A degraded (sub-4px) code needs adequate
   physical size; the `degraded` flag surfaces this but cannot enforce it. The
   placement rules in the README cover print-size responsibility.

4. **Single-decoder validation.** Scannability is tested with `jsQR` only. Real
   scans use ZXing, native iOS/Android, and zbar, which locate codes by the
   precise square finder ratio. The rounded finder patterns are tolerated by
   jsQR but unverified across the broader decoder population. Adding a second
   decoder to CI is an open item.

5. **PNG depends on an unpinned rasteriser.** `@resvg/resvg-js` is an optional
   peer dependency; different versions can anti-alias edges differently. SVG
   output (preferred) has no such dependency.

6. **Damage-first trades print robustness on the tail.** For long records the
   ladder shrinks modules (down to 3px) before dropping EC. A very small module
   is harder for a low-resolution camera to resolve. This only affects records
   beyond ~314 PII chars (already past realistic payroll) and is flagged via
   `degraded`.

7. **Privacy model fixes a capacity floor.** Because PII lives in the QR, QR size
   is fundamentally bounded by PII length. If a future product variant tolerates
   online-only verification, a token-only QR would remove the capacity pressure
   entirely - at the cost of the "Verifiabl never holds PII" guarantee.

---

## 9. If the tail becomes real

The current posture is: keep the frame consistent, degrade the QR damage-first,
and hard-error past the floor so we *learn* when oversized PII actually occurs
(integration testing or production feedback). If that signal arrives, options in
rough order of preference:

1. Cap PII field lengths at the schema layer to match the frame's real capacity.
2. Add a second QR decoder to CI to harden the rounded-finder choice.
3. Reconsider the absolute module floor with real-world scan data.
4. Only if forced: revisit the fixed-frame constraint (e.g. an opt-in larger
   frame size) - explicitly a brand/consistency trade-off, not a default.

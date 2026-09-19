# Official PoseTek app icon

The September 18, 2026 user direction adopts the existing lime-green P header
badge as the official app icon. This asset uses the public Players/Coaches
website badge, one of the references explicitly identified by the user.

- `posetek-app-icon.svg`: resolution-independent master with the Inter Black P
  converted to an outline. No font or network connection is needed to display it.
- `posetek-app-icon-1024.png`: 1024 × 1024 RGB PNG, opaque, for the Xcode AppIcon
  asset catalog. Keep the outer square intact; iOS supplies its own icon mask.
- `posetek-app-photo-1024.jpg`: reusable 1024 × 1024 app photo for documents and
  profile/marketing uses. The native asset catalog uses the PNG.
- `Inter-OFL.txt`: font license for the outlined Inter glyph.

## Reference and adaptation

The source is `app/src/pages/home/MarketingHeader.tsx` and
`app/src/pages/home/home.scss` at website source `61ef7cc`. It is the 34-unit
lime tile (#B7F34A), 3-unit radius, Inter 900 P (#082015), and lower-right
5-unit visible notch. The original badge sits centered on a 48-unit opaque
evergreen canvas (#04130E) to keep its corner detail inside the system mask.
The website's inherited letter spacing and font metrics are retained in the
outlined letter placement. The native header uses a slightly different rounded
P treatment; this master deliberately adopts the user-authorized website badge.

The source SVG, not a generated reinterpretation of the letter, is the master.
Rasterize it to 1024 × 1024, flatten against #04130E, remove alpha, and export
in sRGB. The JPEG is an additional convenience export.

The website navigation and production website have not been changed by this
asset package. Native integration and release steps are in
`brand/app-store/README.md`.

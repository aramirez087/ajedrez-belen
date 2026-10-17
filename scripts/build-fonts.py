# Builds the self-hosted landing fonts in public/fonts/.
#
# 1. Lora and DM Sans, trimmed to the weights the pages use and the Spanish
#    character set. The Lora subset is renamed Belen Display because its
#    license reserves the original font name. Keep public/Lora-OFL.txt and
#    public/Lora-FONTLOG.txt with the generated asset.
# 2. A single-glyph colón (₡, U+20A1) face for prices set in DM Sans. DM Sans
#    does not ship the sign, so draw it from the family's own "C" plus two
#    diagonal strokes; CSS serves it with unicode-range: U+20A1.
#
# Requires fontTools and brotli (pip install fonttools brotli). Sources:
#   Lora variable TTF from github.com/google/fonts (ofl/lora/Lora[wght].ttf),
#   DM Sans from node_modules/@fontsource-variable/dm-sans.
#
#   python3 scripts/build-fonts.py \
#     'Lora[wght].ttf' \
#     node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2
import os
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen

# Basic Latin, Latin-1 (Spanish accents, ¡ ¿ « »), dashes, quotes, ellipsis, bullet, € and ™.
UNICODES = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2022, 0x20AC, 0x2122]
FEATURES = ['kern', 'liga', 'clig', 'calt', 'lnum', 'pnum', 'tnum', 'onum', 'case', 'ccmp', 'locl', 'mark', 'mkmk']


def rename_lora_subset(font):
    """Honor Lora's Reserved Font Name while preserving copyright/license metadata."""
    # Family, unique ID, full name, PostScript, typographic/WWS family and
    # variation PostScript prefix. Other names retain the original attribution.
    for record in font['name'].names:
        if record.nameID in (1, 3, 4, 6, 16, 21, 25):
            replacement = 'BelenDisplay' if record.nameID in (3, 6, 25) else 'Belen Display'
            record.string = record.toUnicode().replace('Lora', replacement).encode(record.getEncoding())


def trim(src, out, axes, rename=None):
    font = TTFont(src, lazy=False)
    options = subset.Options()
    options.layout_features = FEATURES
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    font = instancer.instantiateVariableFont(font, axes, updateFontNames=False)
    if rename:
        rename(font)
    font.flavor = 'woff2'
    font.save(out)
    print(out, os.path.getsize(out), 'bytes')


def colon(src, axes, out, name, stroke_ratio, slant):
    font = TTFont(src)
    if 'fvar' in font:
        font = instancer.instantiateVariableFont(font, axes)
    glyphs = font.getGlyphSet()
    c_name = font.getBestCmap()[ord('C')]
    bounds = BoundsPen(glyphs)
    glyphs[c_name].draw(bounds)
    xmin, ymin, xmax, ymax = bounds.bounds
    upm = font['head'].unitsPerEm
    advance = font['hmtx'][c_name][0]

    pen = TTGlyphPen(glyphs)
    glyphs[c_name].draw(pen)
    # Two strokes crossing the C, overshooting it by 12% above and below.
    thickness = upm * stroke_ratio
    height = ymax - ymin
    bottom, top = ymin - height * 0.12, ymax + height * 0.12
    width = xmax - xmin
    for centre in (xmin + width * 0.40, xmin + width * 0.64):
        lean = (top - bottom) * slant / 2
        low, high = centre - lean, centre + lean
        pen.moveTo((low - thickness / 2, bottom))
        pen.lineTo((high - thickness / 2, top))
        pen.lineTo((high + thickness / 2, top))
        pen.lineTo((low + thickness / 2, bottom))
        pen.closePath()

    builder = FontBuilder(upm, isTTF=True)
    builder.setupGlyphOrder(['.notdef', 'colonsign'])
    builder.setupCharacterMap({0x20A1: 'colonsign'})
    builder.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), 'colonsign': pen.glyph()})
    builder.setupHorizontalMetrics({'.notdef': (upm // 2, 0), 'colonsign': (advance, int(xmin))})
    builder.setupHorizontalHeader(ascent=font['hhea'].ascent, descent=font['hhea'].descent)
    os2 = font['OS/2']
    builder.setupOS2(sTypoAscender=os2.sTypoAscender, sTypoDescender=os2.sTypoDescender, sTypoLineGap=os2.sTypoLineGap,
                     usWinAscent=os2.usWinAscent, usWinDescent=os2.usWinDescent)
    builder.setupNameTable({'familyName': name, 'styleName': 'Regular'})
    builder.setupPost()
    builder.font.flavor = 'woff2'
    builder.save(out)
    print(out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: python3 scripts/build-fonts.py Lora-variable.ttf DM-Sans-variable.woff2')
    lora, dm_sans = sys.argv[1:]
    # Upright display headings use 500–700; body and interface text use 400–700.
    trim(lora, 'public/fonts/lora-latin-normal.woff2', {'wght': (500, 700)}, rename=rename_lora_subset)
    trim(dm_sans, 'public/fonts/dm-sans-latin.woff2', {'wght': (400, 700)})
    colon(dm_sans, {'wght': 560}, 'public/fonts/dm-sans-colon.woff2', 'DM Sans Colon', 0.052, 0.14)

# Builds the self-hosted landing fonts in public/fonts/.
#
# 1. Bodoni Moda and DM Sans, trimmed to the weights and optical sizes the
#    pages use and to the Spanish character set (about a quarter smaller).
#    The roman Bodoni also gains one kerning pair the family lacks: its U ends
#    in a hairline stem, so "Un", "Una" opened up into "U n" at display sizes.
# 2. Single-glyph colón (₡, U+20A1) faces. Neither family ships the sign, so
#    prices would fall back to a system font. Each draws the sign from its own
#    family's "C" plus two diagonal strokes; CSS serves it with
#    unicode-range: U+20A1.
#
# Requires fontTools and brotli (pip install fonttools brotli). Sources:
#   Bodoni Moda variable TTFs from github.com/google/fonts (ofl/bodonimoda),
#   DM Sans from node_modules/@fontsource-variable/dm-sans.
#
#   python3 scripts/build-fonts.py \
#     'BodoniModa[opsz,wght].ttf' 'BodoniModa-Italic[opsz,wght].ttf' \
#     node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2
import os
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.otlLib.builder import buildLookup, buildPairPosGlyphsSubtable, buildValue

# Basic Latin, Latin-1 (Spanish accents, ¡ ¿ « »), dashes, quotes, ellipsis, bullet, € and ™.
UNICODES = [*range(0x20, 0x7F), *range(0xA0, 0x100), 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x2022, 0x20AC, 0x2122]
FEATURES = ['kern', 'liga', 'clig', 'calt', 'lnum', 'pnum', 'tnum', 'onum', 'case', 'ccmp', 'locl', 'mark', 'mkmk']


def add_kerning(font, first, seconds, value):
    """Append one pair-positioning lookup to every 'kern' feature of the font."""
    cmap = font.getBestCmap()
    left = cmap[ord(first)]
    pairs = {(left, cmap[ord(c)]): (buildValue({'XAdvance': value}), None) for c in seconds if ord(c) in cmap}
    subtable = buildPairPosGlyphsSubtable(pairs, font.getReverseGlyphMap())
    gpos = font['GPOS'].table
    gpos.LookupList.Lookup.append(buildLookup([subtable]))
    gpos.LookupList.LookupCount = len(gpos.LookupList.Lookup)
    index = gpos.LookupList.LookupCount - 1
    for record in gpos.FeatureList.FeatureRecord:
        if record.FeatureTag == 'kern':
            record.Feature.LookupListIndex.append(index)
            record.Feature.LookupCount = len(record.Feature.LookupListIndex)


def trim(src, out, axes, kerning=None):
    font = TTFont(src, lazy=False)
    options = subset.Options()
    options.layout_features = FEATURES
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    font = instancer.instantiateVariableFont(font, axes, updateFontNames=False)
    if kerning:
        add_kerning(font, *kerning)
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
    bodoni, bodoni_italic, dm_sans = sys.argv[1:4]
    # Weights and optical sizes measured on the rendered pages (roman 500–800, italic 400–700, text from 15 px).
    trim(bodoni, 'public/fonts/bodoni-moda-latin-normal.woff2', {'wght': (500, 800), 'opsz': (14, 96)},
         kerning=('U', 'nñmrpijbhkl', -80))
    trim(bodoni_italic, 'public/fonts/bodoni-moda-latin-italic.woff2', {'wght': (400, 700), 'opsz': (14, 96)})
    trim(dm_sans, 'public/fonts/dm-sans-latin.woff2', {'wght': (400, 700)})
    colon(bodoni, {'wght': 600, 'opsz': 72}, 'public/fonts/bodoni-moda-colon.woff2', 'Bodoni Moda Colon', 0.05, 0.18)
    colon(dm_sans, {'wght': 560}, 'public/fonts/dm-sans-colon.woff2', 'DM Sans Colon', 0.052, 0.14)

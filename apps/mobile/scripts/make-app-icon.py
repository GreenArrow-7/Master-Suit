from PIL import Image
import numpy as np, os

SRC = 'yh-mark.webp'
APP = r'C:/Users/admin/Music/Youhan One/Master-Suit/.claude/worktrees/wonderful-lalande-67811a/apps/mobile/ios/App/App'

mark = Image.open(SRC).convert('RGBA')
a = np.array(mark); ys, xs = np.where(a[:, :, 3] > 40)
mark = mark.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))   # trim transparent margin
ASPECT = mark.width / mark.height

def compose(canvas_px, width_ratio, bg):
    """Mark centred on an opaque square, original proportions preserved."""
    w = round(canvas_px * width_ratio)
    h = round(w / ASPECT)
    m = mark.resize((w, h), Image.LANCZOS)
    out = Image.new('RGB', (canvas_px, canvas_px), bg)          # RGB => no alpha (App Store requires)
    tmp = Image.new('RGBA', (canvas_px, canvas_px), (0, 0, 0, 0))
    tmp.paste(m, ((canvas_px - w) // 2, (canvas_px - h) // 2), m)
    out.paste(tmp, (0, 0), tmp)
    return out

WHITE = (255, 255, 255)
NAVY  = (2, 8, 23)          # #020817, the mark's established dark backdrop in apps/web/src/app/icon.svg

# App Store / app icon: 1024, brand's own 73.3% width ratio from youhan.in's apple-touch-icon
compose(1024, 0.733, WHITE).save(os.path.join(APP, 'Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))
# Launch screen: same mark, calmer 28% so it reads as a splash not an icon
splash = compose(2732, 0.28, WHITE)
for n in ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']:
    splash.save(os.path.join(APP, 'Assets.xcassets/Splash.imageset/' + n))

# previews for the user
compose(1024, 0.733, WHITE).save('preview-icon-white.png')
compose(1024, 0.733, NAVY).save('preview-icon-navy.png')
compose(512, 0.28, WHITE).save('preview-splash.png')

ic = Image.open(os.path.join(APP, 'Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'))
print('icon:', ic.size, ic.mode, '(mode RGB = no alpha channel)')
print('aspect preserved: %.4f (source %.4f)' % (ASPECT, 1338 / 1114))

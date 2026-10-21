from PIL import Image, ImageDraw

def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=255)
    return m

def draw_icon(size, path):
    img = Image.new('RGBA', (size, size), (0,0,0,0))
    # background vertical gradient (dark navy)
    top = (13, 20, 48); bot = (11, 16, 32)
    for y in range(size):
        t = y / (size-1)
        r = int(top[0]+(bot[0]-top[0])*t)
        g = int(top[1]+(bot[1]-top[1])*t)
        b = int(top[2]+(bot[2]-top[2])*t)
        d = ImageDraw.Draw(img)
        d.line([(0,y),(size,y)], fill=(r,g,b,255))
    mask = rounded_mask(size, int(size*0.22))
    bg = Image.new('RGBA',(size,size),(0,0,0,0))
    bg.paste(img,(0,0),mask)
    img = bg
    d = ImageDraw.Draw(img)

    # ruler bar
    S = size
    u = S/512.0  # unit
    bar_top = int(240*u); bar_h = int(64*u)
    bar_x0 = int(96*u); bar_x1 = int(416*u)
    bar_y0 = bar_top; bar_y1 = bar_top+bar_h
    # rounded bar
    d.rounded_rectangle([bar_x0, bar_y0, bar_x1, bar_y1], radius=int(12*u), fill=(230,237,247,255))
    # measured segment in cyan
    seg_x0 = int(150*u); seg_x1 = int(300*u)
    d.rounded_rectangle([seg_x0, bar_y0, seg_x1, bar_y1], radius=int(12*u), fill=(34,211,238,255))
    # tick marks
    n = 16
    for i in range(n+1):
        x = bar_x0 + int((bar_x1-bar_x0)*i/n)
        long_tick = (i % 4 == 0)
        th = int((36 if long_tick else 20)*u)
        tt = bar_y0 + int((bar_h-th)/2)
        col = (20,25,45,255) if long_tick else (80,95,120,255)
        d.line([(x,tt),(x,tt+th)], fill=col, width=max(1,int(3*u)))
    # endpoint dots on segment
    for ex in (seg_x0, seg_x1):
        cy = (bar_y0+bar_y1)//2
        d.ellipse([ex-int(14*u), cy-int(14*u), ex+int(14*u), cy+int(14*u)], fill=(255,255,255,255))

    img.save(path, 'PNG')

base = r"C:\Users\jiev\Doubao\chats\2026-10-21\new-chat\measure-cam\icons"
draw_icon(192, base + r"\icon-192.png")
draw_icon(512, base + r"\icon-512.png")
print("icons generated")

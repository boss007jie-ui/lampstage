"""把 hero 图 + 二维码转 base64，生成朋友圈海报 HTML（4张竖版 1080x1350）。"""
import base64, json
from pathlib import Path

ROOT = Path(r"C:\Users\boss0\Desktop\05-项目文件夹\hermes\lamp-saas-mvp")
PROMO = ROOT / "promo-assets"
PUB = ROOT / "apps" / "web" / "public"

def b64(p):
    return base64.b64encode(Path(p).read_bytes()).decode()

hero1 = b64(PROMO / "hero1.jpg")
hero2 = b64(PROMO / "hero2.jpg")
showcase_living = b64(PUB / "showcase" / "01_living_pendant.jpg")
showcase_dining = b64(PUB / "showcase" / "02_dining_long_table.jpg")
showcase_bedroom = b64(PUB / "showcase" / "03_bedroom_wall_sconce.jpg")
showcase_floor = b64(PUB / "showcase" / "04_floor_lamp_corner.jpg")
qr = b64(PUB / "contact" / "wechat-qr.png")

html = f"""<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{ background:#888; font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }}
.poster {{ width:1080px; height:1350px; position:relative; overflow:hidden; margin:0 0 40px 0; }}

/* ===== 海报1：我做了个 AI 产品（主打能力）===== */
.p1 {{ background:linear-gradient(160deg,#14141f,#1c1c2e); color:#fff; display:flex; flex-direction:column; }}
.p1 .top {{ padding:90px 80px 0; }}
.p1 .eyebrow {{ font-size:30px; letter-spacing:8px; color:#f3a93b; font-weight:600; }}
.p1 .h1 {{ font-size:78px; font-weight:800; line-height:1.2; margin-top:28px; letter-spacing:-1px; }}
.p1 .h1 .hl {{ color:#f3a93b; }}
.p1 .sub {{ font-size:34px; color:#b8b3c8; margin-top:30px; line-height:1.6; }}
.p1 .shot {{ margin:56px 60px 0; border-radius:24px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.5); flex:1; }}
.p1 .shot img {{ width:100%; height:100%; object-fit:cover; }}
.p1 .foot {{ padding:36px 80px 70px; display:flex; justify-content:space-between; align-items:center; }}
.p1 .domain {{ font-size:38px; font-weight:700; }}
.p1 .domain .tld {{ color:#f3a93b; }}
.p1 .tag {{ font-size:26px; color:#8c8aa0; }}

/* ===== 海报2：灯境干嘛用（前后对比）===== */
.p2 {{ background:#faf8f3; color:#171717; display:flex; flex-direction:column; }}
.p2 .hd {{ padding:80px 70px 40px; text-align:center; }}
.p2 .hd .t {{ font-size:64px; font-weight:800; letter-spacing:-1px; }}
.p2 .hd .t .hl {{ color:#533afd; }}
.p2 .hd .s {{ font-size:32px; color:#666; margin-top:20px; }}
.p2 .compare {{ flex:1; display:flex; gap:0; align-items:center; padding:0 50px; }}
.p2 .col {{ flex:1; text-align:center; }}
.p2 .col img {{ width:100%; border-radius:20px; box-shadow:0 16px 40px rgba(0,0,0,.15); }}
.p2 .lampimg {{ width:64%; aspect-ratio:1; object-fit:contain; background:#fff; border:2px dashed #ccc; padding:30px; }}
.p2 .label {{ font-size:30px; font-weight:600; margin-top:24px; }}
.p2 .label.before {{ color:#999; }}
.p2 .label.after {{ color:#533afd; }}
.p2 .arrow {{ font-size:80px; color:#f3a93b; padding:0 10px; }}
.p2 .foot {{ padding:40px 70px 70px; text-align:center; font-size:36px; font-weight:700; }}
.p2 .foot .tld {{ color:#533afd; }}

/* ===== 海报3：4场景展示 ===== */
.p3 {{ background:linear-gradient(160deg,#1c1c2e,#14141f); color:#fff; display:flex; flex-direction:column; }}
.p3 .hd {{ padding:80px 70px 36px; }}
.p3 .hd .t {{ font-size:62px; font-weight:800; line-height:1.25; }}
.p3 .hd .t .hl {{ color:#f3a93b; }}
.p3 .hd .s {{ font-size:30px; color:#b8b3c8; margin-top:18px; }}
.p3 .grid {{ flex:1; display:grid; grid-template-columns:1fr 1fr; gap:18px; padding:0 60px; }}
.p3 .grid img {{ width:100%; height:100%; object-fit:cover; border-radius:18px; }}
.p3 .foot {{ padding:40px 70px 70px; display:flex; justify-content:space-between; align-items:center; }}
.p3 .domain {{ font-size:38px; font-weight:700; }}
.p3 .domain .tld {{ color:#f3a93b; }}
.p3 .tag {{ font-size:26px; color:#8c8aa0; }}

/* ===== 海报4：价格+扫码 ===== */
.p4 {{ background:#faf8f3; color:#171717; display:flex; flex-direction:column; padding:90px 80px; }}
.p4 .t {{ font-size:66px; font-weight:800; letter-spacing:-1px; }}
.p4 .t .hl {{ color:#533afd; }}
.p4 .s {{ font-size:32px; color:#666; margin-top:22px; line-height:1.6; }}
.p4 .packs {{ margin-top:60px; display:flex; flex-direction:column; gap:26px; flex:1; }}
.p4 .pack {{ display:flex; justify-content:space-between; align-items:center; background:#fff; border:1px solid #eee; border-radius:20px; padding:38px 46px; }}
.p4 .pack.hl {{ border:2px solid #533afd; box-shadow:0 16px 40px rgba(83,58,253,.12); }}
.p4 .pname {{ font-size:38px; font-weight:700; }}
.p4 .pqty {{ font-size:28px; color:#888; margin-top:8px; }}
.p4 .pprice {{ font-size:52px; font-weight:800; color:#533afd; }}
.p4 .pprice .unit {{ font-size:26px; color:#999; font-weight:500; }}
.p4 .qrbox {{ margin-top:50px; display:flex; align-items:center; gap:36px; background:#171717; border-radius:24px; padding:40px 50px; color:#fff; }}
.p4 .qrbox img {{ width:200px; height:200px; border-radius:16px; background:#fff; }}
.p4 .qrtext .big {{ font-size:42px; font-weight:700; }}
.p4 .qrtext .small {{ font-size:28px; color:#b8b3c8; margin-top:14px; line-height:1.5; }}
.p4 .qrtext .dm {{ font-size:30px; color:#f3a93b; margin-top:18px; font-weight:600; }}
</style></head><body>

<!-- 海报1 -->
<div class="poster p1">
  <div class="top">
    <div class="eyebrow">AI 实战作品</div>
    <div class="h1">我用 AI 做了个<br><span class="hl">能赚钱的网站</span></div>
    <div class="sub">从想法到上线，全程 AI 搭建<br>这是其中一个真实产品 👇</div>
  </div>
  <div class="shot"><img src="data:image/jpeg;base64,{hero1}"/></div>
  <div class="foot">
    <div class="domain">lampstage<span class="tld">.com</span></div>
    <div class="tag">灯境 · AI 家居场景图</div>
  </div>
</div>

<!-- 海报2 -->
<div class="poster p2">
  <div class="hd">
    <div class="t">一张灯具图<br>变<span class="hl">专业家居场景图</span></div>
    <div class="s">灯具卖家不用再花钱拍摄、找场地</div>
  </div>
  <div class="compare">
    <div class="col">
      <img class="lampimg" src="data:image/jpeg;base64,{showcase_floor}"/>
      <div class="label before">上传商品图</div>
    </div>
    <div class="arrow">→</div>
    <div class="col">
      <img src="data:image/jpeg;base64,{hero1}"/>
      <div class="label after">AI 生成场景图</div>
    </div>
  </div>
  <div class="foot">lampstage<span class="tld">.com</span> · 注册送 20 张</div>
</div>

<!-- 海报3 -->
<div class="poster p3">
  <div class="hd">
    <div class="t">同一盏灯<br><span class="hl">N 种家居风格</span></div>
    <div class="s">客厅 / 餐厅 / 卧室 / 角落，一键生成</div>
  </div>
  <div class="grid">
    <img src="data:image/jpeg;base64,{showcase_living}"/>
    <img src="data:image/jpeg;base64,{showcase_dining}"/>
    <img src="data:image/jpeg;base64,{showcase_bedroom}"/>
    <img src="data:image/jpeg;base64,{hero2}"/>
  </div>
  <div class="foot">
    <div class="domain">lampstage<span class="tld">.com</span></div>
    <div class="tag">灯境 Lampstage</div>
  </div>
</div>

<!-- 海报4 -->
<div class="poster p4">
  <div class="t">想试试？<span class="hl">扫码体验</span></div>
  <div class="s">注册即送 20 张免费额度，够你出 6 组场景图</div>
  <div class="packs">
    <div class="pack"><div><div class="pname">体验包</div><div class="pqty">100 张</div></div><div class="pprice">¥30<span class="unit"> /包</span></div></div>
    <div class="pack hl"><div><div class="pname">标准包 · 最划算</div><div class="pqty">400 张 · ¥0.25/张</div></div><div class="pprice">¥99<span class="unit"> /包</span></div></div>
    <div class="pack"><div><div class="pname">大包</div><div class="pqty">1500 张 · ¥0.20/张</div></div><div class="pprice">¥299<span class="unit"> /包</span></div></div>
  </div>
  <div class="qrbox">
    <img src="data:image/png;base64,{qr}"/>
    <div class="qrtext">
      <div class="big">扫码加我体验</div>
      <div class="small">AI 做网站 / 工具<br>有需求也可以聊</div>
      <div class="dm">lampstage.com</div>
    </div>
  </div>
</div>

</body></html>"""

OUT = ROOT / "apps" / "web" / "public" / "promo.html"
OUT.write_text(html, encoding="utf-8")
print(f"wrote {OUT}  ({len(html)//1024}KB)")

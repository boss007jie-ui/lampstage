/**
 * Prisma seed: 灯境 AI MVP 第一批 6 个高频灯具模板
 * 来源: PRD v3 §6 “MVP 第一批模板”
 *
 * 运行: npx prisma db seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedTemplate = {
  id: string;
  name: string;
  category: string;
  lamp_type: string;
  scene_space: string;
  preview_image_url: string;
  prompt_template: string;
  sort_order: number;
};

const QUALITY_RULES = `
[Lamp identity preservation]
- Keep the original product structure, color, materials and number of shades.
- Do NOT add extra heads, arms, wires or parts.
- Do NOT change metal / glass / fabric / wood materials.
- Warm lamps must NOT become RGB / neon / stage / disco lights.
- Product scale must match real interior proportion.

[Installation realism]
- Pendants need a visible ceiling cord, chain or rod (no floating).
- Wall lamps must be mounted flush against a wall.
- Table lamps must rest on a real desk, console or nightstand.
- Floor lamps must stand on the floor with a believable base.
- Ceiling lamps must attach to the ceiling.

[Lighting]
- Soft ambient light, direction matches the lamp position.
- Warm color temperature unless the product is clearly cool-white.
- No exaggerated beams, no neon, no stage / club lighting.
- The whole scene stays well exposed; product remains clearly visible.

[Output]
- Photo-real interior, clean composition, magazine quality.
- No watermark, no caption, no UI overlay, no garbled text.
`.trim();

const templates: SeedTemplate[] = [
  {
    id: "tpl_dining_long_table_pendant",
    name: "餐厅长桌吊灯",
    category: "pendant",
    lamp_type: "吊灯",
    scene_space: "dining",
    preview_image_url: "/templates/dining_long_table_pendant.jpg",
    prompt_template: `Modern dining room with a long wooden dining table, the uploaded pendant lamp hanging above the center of the table at proper height, warm ambient evening light, tasteful tableware, soft window light at the back. ${QUALITY_RULES}`,
    sort_order: 10,
  },
  {
    id: "tpl_living_room_main_light",
    name: "现代客厅主灯",
    category: "pendant",
    lamp_type: "吊灯",
    scene_space: "living",
    preview_image_url: "/templates/living_room_main_light.jpg",
    prompt_template: `Modern minimalist living room with sofa, coffee table, area rug, large windows. The uploaded lamp is the main ceiling fixture in the center of the room. Daylight + warm interior glow. ${QUALITY_RULES}`,
    sort_order: 20,
  },
  {
    id: "tpl_bedroom_wall_sconce",
    name: "卧室床头壁灯",
    category: "wall",
    lamp_type: "壁灯",
    scene_space: "bedroom",
    preview_image_url: "/templates/bedroom_wall_sconce.jpg",
    prompt_template: `Cozy modern bedroom, the uploaded wall sconce mounted on the wall above the nightstand next to a neatly made bed. Warm bedside glow, soft shadows, peaceful evening mood. ${QUALITY_RULES}`,
    sort_order: 30,
  },
  {
    id: "tpl_floor_lamp_beside_sofa",
    name: "沙发旁落地灯",
    category: "floor",
    lamp_type: "落地灯",
    scene_space: "living",
    preview_image_url: "/templates/floor_lamp_beside_sofa.jpg",
    prompt_template: `Contemporary living room corner with a fabric sofa and side table; the uploaded floor lamp standing on the floor right beside the sofa, providing reading light. Soft evening ambience. ${QUALITY_RULES}`,
    sort_order: 40,
  },
  {
    id: "tpl_bedside_table_lamp",
    name: "卧室床头柜台灯",
    category: "table",
    lamp_type: "台灯",
    scene_space: "bedroom",
    preview_image_url: "/templates/bedside_table_lamp.jpg",
    prompt_template: `Warm bedroom scene, the uploaded table lamp resting on a wooden nightstand beside a bed with linen bedding. Open book, glass of water, gentle warm reading light. ${QUALITY_RULES}`,
    sort_order: 50,
  },
  {
    id: "tpl_hotel_lobby_pendant",
    name: "酒店大堂吊灯",
    category: "pendant",
    lamp_type: "吊灯",
    scene_space: "hotel",
    preview_image_url: "/templates/hotel_lobby_pendant.jpg",
    prompt_template: `Premium hotel lobby with marble floor, lounge seating, reception desk in the distance. The uploaded pendant lamp is suspended from the high ceiling as the lobby centerpiece. Cinematic interior lighting. ${QUALITY_RULES}`,
    sort_order: 60,
  },
];

async function main() {
  for (const t of templates) {
    await prisma.template.upsert({
      where: { id: t.id },
      create: { ...t, is_active: true },
      update: { ...t, is_active: true },
    });
  }
  const count = await prisma.template.count({ where: { is_active: true } });
  console.log(`Seeded templates. Active count: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

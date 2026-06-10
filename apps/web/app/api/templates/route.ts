import { NextResponse } from "next/server";

/**
 * GET /api/templates
 *
 * 返回 MVP 第一批 6 个高频模板。Task 4 阶段不依赖数据库，直接返回静态数据，
 * 与 prisma/seed.ts 保持一致。后续接入数据库后会改为从 Template 表读取。
 */
const TEMPLATES = [
  {
    id: "tpl_dining_long_table_pendant",
    name: "餐厅长桌吊灯",
    category: "pendant",
    lamp_type: "吊灯",
    scene_space: "dining",
    preview_image_url: "/templates/dining_long_table_pendant.jpg",
    sort_order: 10,
  },
  {
    id: "tpl_living_room_main_light",
    name: "现代客厅主灯",
    category: "pendant",
    lamp_type: "吊灯",
    scene_space: "living",
    preview_image_url: "/templates/living_room_main_light.jpg",
    sort_order: 20,
  },
  {
    id: "tpl_bedroom_wall_sconce",
    name: "卧室床头壁灯",
    category: "wall",
    lamp_type: "壁灯",
    scene_space: "bedroom",
    preview_image_url: "/templates/bedroom_wall_sconce.jpg",
    sort_order: 30,
  },
  {
    id: "tpl_floor_lamp_beside_sofa",
    name: "沙发旁落地灯",
    category: "floor",
    lamp_type: "落地灯",
    scene_space: "living",
    preview_image_url: "/templates/floor_lamp_beside_sofa.jpg",
    sort_order: 40,
  },
  {
    id: "tpl_bedside_table_lamp",
    name: "卧室床头柜台灯",
    category: "table",
    lamp_type: "台灯",
    scene_space: "bedroom",
    preview_image_url: "/templates/bedside_table_lamp.jpg",
    sort_order: 50,
  },
  {
    id: "tpl_hotel_lobby_pendant",
    name: "酒店大堂吊灯",
    category: "pendant",
    lamp_type: "吊灯",
    scene_space: "hotel",
    preview_image_url: "/templates/hotel_lobby_pendant.jpg",
    sort_order: 60,
  },
];

export async function GET() {
  return NextResponse.json({ templates: TEMPLATES });
}

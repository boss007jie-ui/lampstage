import type { DictKey } from "@/lib/brand";

export type SceneExample = {
  id: string; src: string; title: DictKey; width: number; height: number;
  category: "living" | "dining" | "reading" | "bedroom" | "hotel";
  detail: { zh: string; en: string };
};

export const SCENE_EXAMPLES: SceneExample[] = [
  { id: "living", width: 1632, height: 964, src: "/scene-examples/living-pendant.png", title: "scene_living", category: "living", detail: { zh: "自然日光、浅色家居与柔和灯光，让吊灯融入日常空间。", en: "Daylight, a light interior and a warm pendant create an everyday living scene." } },
  { id: "dining", width: 1774, height: 887, src: "/scene-examples/dining-pendant.png", title: "scene_dining", category: "dining", detail: { zh: "长桌、暖光与聚会氛围，呈现吊灯和空间的关系。", en: "A long table and warm lighting show how a pendant relates to the dining space." } },
  { id: "reading", width: 1774, height: 887, src: "/scene-examples/reading-floor.png?v=20261007-2", title: "scene_reading", category: "reading", detail: { zh: "阅读角、木质书架与落地灯，构思安静的生活场景。", en: "A floor lamp, bookshelves and an armchair form a quiet reading corner." } },
  { id: "bedroom", width: 1376, height: 768, src: "/showcase/03_bedroom_wall_sconce.jpg", title: "scene_bedroom", category: "bedroom", detail: { zh: "床头壁灯与卧室布置，探索温暖、放松的空间氛围。", en: "Bedside lighting explores a warm and relaxing bedroom atmosphere." } },
  { id: "hotel", width: 1376, height: 768, src: "/showcase/05_hotel_lobby.jpg", title: "scene_hotel", category: "hotel", detail: { zh: "大堂吊灯与开阔空间，探索不同尺度的场景展示。", en: "A lobby chandelier explores lighting in a more open architectural space." } },
];
